"""Acquire, transform and validate the oil market dashboard datasets.

The whole data pipeline lives in this module so its lineage is inspectable:

* ``acquire()`` downloads the raw sources into ``data/raw/`` (live mode only);
* ``transform_*()`` shape each raw source into a tidy record-level dataset;
* ``derive_*()`` add the analytical columns used by the views;
* ``validate()`` checks every dataset against the column contract declared in
  ``dashboard.yml`` and stops the pipeline on any violation.

Offline mode (``DASHBOARD_SAMPLE_MODE=1``) never touches the network: it reads
the bundled samples, recomputes the derived columns from their base columns,
validates the result and writes only the declared processed outputs.

Usage::

    DASHBOARD_SAMPLE_MODE=1 python -m src.data      # offline rebuild (used by the checker)
    python -m src.data --acquire                    # refresh data/raw/ from the live sources
    python -m src.data                              # live transform from data/raw/
    python -m src.data --refresh-sample             # live transform, then rewrite the samples
    python -m src.data --validate                   # validate the processed outputs
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
MANIFEST = ROOT / "dashboard.yml"

RAW_SOURCES = {
    # EIA spot prices, republished unchanged as monthly averages by the
    # DataHub "core/oil-prices" package (EIA series RBRTE and RWTC).
    "brent-monthly.csv": "https://raw.githubusercontent.com/datasets/oil-prices/main/data/brent-monthly.csv",
    "wti-monthly.csv": "https://raw.githubusercontent.com/datasets/oil-prices/main/data/wti-monthly.csv",
    "brent-daily.csv": "https://raw.githubusercontent.com/datasets/oil-prices/main/data/brent-daily.csv",
    "wti-daily.csv": "https://raw.githubusercontent.com/datasets/oil-prices/main/data/wti-daily.csv",
    # Energy Institute Statistical Review of World Energy, as compiled by Our World in Data.
    "owid-energy-data.csv": "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv",
}

PRICE_START = "1990-01-01"
DAILY_START = "2024-01-01"   # the recent-period view: every trading day since the start of 2024
EI_REGIONS = {
    "Africa (EI)": "Africa",
    "Asia Pacific (EI)": "Asia Pacific",
    "CIS (EI)": "CIS",
    "Europe (EI)": "Europe",
    "Middle East (EI)": "Middle East",
    "North America (EI)": "North America",
    "South and Central America (EI)": "South and Central America",
}
COUNTRIES = [
    "World", "United States", "China", "India", "Japan", "Russia", "Saudi Arabia",
    "Brazil", "South Korea", "Canada", "Germany", "Mexico", "Indonesia", "France",
    "United Kingdom", "Norway",
]
COUNTRY_START, INDEX_YEAR = 2000, 2019
# Before 2017 OWID fills country oil production from a second source (The Shift Data Portal);
# from 2017 every production value comes from the Energy Institute, so the map starts there.
MAP_START = 2017

DATASET_FILES = {
    "prices": ("data/sample.csv", "data/processed.csv"),
    "regions": ("data/sample_regions.csv", "data/processed_regions.csv"),
    "countries": ("data/sample_countries.csv", "data/processed_countries.csv"),
    "country_map": ("data/sample_country_map.csv", "data/processed_country_map.csv"),
    "prices_daily": ("data/sample_prices_daily.csv", "data/processed_prices_daily.csv"),
}


# --------------------------------------------------------------------------- acquire
def acquire() -> None:
    """Download every raw source into data/raw/ with a timeout and clear errors."""
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in RAW_SOURCES.items():
        try:
            with urlopen(url, timeout=60) as response:
                body = response.read()
        except (URLError, TimeoutError, OSError) as error:
            sys.exit(
                f"Could not fetch {url}: {error}. Check your connection, or run "
                "offline with DASHBOARD_SAMPLE_MODE=1 to rebuild from the bundled samples."
            )
        if not body.strip():
            sys.exit(f"{url} returned an empty body; refusing to overwrite {name}")
        (RAW / name).write_bytes(body)
        print(f"Wrote {RAW / name} ({len(body):,} bytes)")


# --------------------------------------------------------------------------- transform
def transform_prices() -> pd.DataFrame:
    """Monthly Brent and WTI averages in long format, dated to the first of the month."""
    frames = []
    for benchmark, name in (("Brent", "brent-monthly.csv"), ("WTI", "wti-monthly.csv")):
        raw = pd.read_csv(RAW / name)
        if list(raw.columns) != ["Date", "Price"]:
            raise ValueError(f"Unexpected columns in {name}: {list(raw.columns)}")
        frame = pd.DataFrame(
            {
                # DataHub stamps a monthly average on the 15th; we use the month start.
                "date": pd.to_datetime(raw["Date"]).dt.to_period("M").dt.start_time.dt.strftime("%Y-%m-%d"),
                "benchmark": benchmark,
                "price_usd_per_bbl": pd.to_numeric(raw["Price"], errors="raise").round(2),
            }
        )
        frames.append(frame.loc[frame["date"] >= PRICE_START])
    return pd.concat(frames, ignore_index=True)


def transform_prices_daily() -> pd.DataFrame:
    """Daily Brent and WTI spot prices from 2024 onward (each benchmark's own trading days)."""
    frames = []
    for benchmark, name in (("Brent", "brent-daily.csv"), ("WTI", "wti-daily.csv")):
        raw = pd.read_csv(RAW / name)
        if list(raw.columns) != ["Date", "Price"]:
            raise ValueError(f"Unexpected columns in {name}: {list(raw.columns)}")
        frame = pd.DataFrame({
            "date": pd.to_datetime(raw["Date"]).dt.strftime("%Y-%m-%d"),
            "benchmark": benchmark,
            "price_usd_per_bbl": pd.to_numeric(raw["Price"], errors="raise").round(2),
        })
        frames.append(frame.loc[frame["date"] >= DAILY_START])
    return pd.concat(frames, ignore_index=True)


def _owid() -> pd.DataFrame:
    return pd.read_csv(RAW / "owid-energy-data.csv", low_memory=False)


def transform_regions() -> pd.DataFrame:
    """Energy Institute regional oil production and consumption, 1965 onward."""
    owid = _owid()
    keep = owid.loc[owid["country"].isin(list(EI_REGIONS) + ["World"])].copy()
    keep = keep.dropna(subset=["oil_production", "oil_consumption"])
    return pd.DataFrame(
        {
            "year": keep["year"].astype(int),
            "region": keep["country"].map(lambda name: EI_REGIONS.get(name, name)),
            "oil_production_twh": keep["oil_production"].round(3),
            "oil_consumption_twh": keep["oil_consumption"].round(3),
        }
    ).reset_index(drop=True)


def transform_countries() -> pd.DataFrame:
    """Oil consumption, oil share of primary energy and oil use per person by country."""
    owid = _owid()
    keep = owid.loc[owid["country"].isin(COUNTRIES) & (owid["year"] >= COUNTRY_START)].copy()
    keep = keep.dropna(subset=["oil_consumption", "oil_share_energy", "oil_energy_per_capita"])
    return pd.DataFrame(
        {
            "year": keep["year"].astype(int),
            "country": keep["country"],
            "oil_consumption_twh": keep["oil_consumption"].round(3),
            "oil_share_energy_pct": keep["oil_share_energy"].round(3),
            "oil_per_capita_kwh": keep["oil_energy_per_capita"].round(1),
        }
    ).reset_index(drop=True)


def transform_country_map() -> pd.DataFrame:
    """Every country the Energy Institute reports, 2017 onward, for the world map.

    Production is only reported separately for larger producers, so it stays missing
    (not zero) where the source does not list it; net balance is then missing too.
    """
    owid = _owid()
    iso = owid["iso_code"].fillna("")
    keep = owid.loc[iso.str.fullmatch(r"[A-Z]{3}") & (owid["year"] >= MAP_START)].copy()
    keep = keep.loc[keep["oil_consumption"].notna() | keep["oil_production"].notna()]
    return pd.DataFrame(
        {
            "year": keep["year"].astype(int),
            "iso_code": keep["iso_code"],
            "country": keep["country"],
            "oil_production_twh": keep["oil_production"].round(3),
            "oil_consumption_twh": keep["oil_consumption"].round(3),
            "oil_per_capita_kwh": keep["oil_energy_per_capita"].round(1),
            "oil_share_energy_pct": keep["oil_share_energy"].round(3),
        }
    ).reset_index(drop=True)


# --------------------------------------------------------------------------- derive
def derive_prices(frame: pd.DataFrame) -> pd.DataFrame:
    """Add the 12-month percentage change for each benchmark."""
    frame = frame[["date", "benchmark", "price_usd_per_bbl"]].copy()
    frame = frame.sort_values(["benchmark", "date"]).reset_index(drop=True)
    parsed = pd.to_datetime(frame["date"])
    lagged = frame.assign(date=(parsed + pd.DateOffset(years=1)).dt.strftime("%Y-%m-%d"))
    lagged = lagged.rename(columns={"price_usd_per_bbl": "price_12m_earlier"})
    frame = frame.merge(lagged, on=["date", "benchmark"], how="left")
    frame["change_12m_pct"] = ((frame["price_usd_per_bbl"] / frame["price_12m_earlier"] - 1) * 100).round(2)
    return frame.drop(columns="price_12m_earlier")


def derive_regions(frame: pd.DataFrame) -> pd.DataFrame:
    """Add net balance (production minus consumption) and each region's world shares."""
    frame = frame[["year", "region", "oil_production_twh", "oil_consumption_twh"]].copy()
    frame["date"] = frame["year"].astype(int).astype(str) + "-12-31"
    frame["net_balance_twh"] = (frame["oil_production_twh"] - frame["oil_consumption_twh"]).round(3)
    world = frame.loc[frame["region"] == "World"].set_index("year")
    frame["share_of_world_production_pct"] = (
        frame["oil_production_twh"] / frame["year"].map(world["oil_production_twh"]) * 100
    ).round(2)
    frame["share_of_world_consumption_pct"] = (
        frame["oil_consumption_twh"] / frame["year"].map(world["oil_consumption_twh"]) * 100
    ).round(2)
    columns = ["date", "year", "region", "oil_production_twh", "oil_consumption_twh", "net_balance_twh",
               "share_of_world_production_pct", "share_of_world_consumption_pct"]
    return frame[columns].sort_values(["region", "year"]).reset_index(drop=True)


def derive_countries(frame: pd.DataFrame) -> pd.DataFrame:
    """Add consumption indexed to the pre-pandemic year (2019 = 100)."""
    frame = frame[["year", "country", "oil_consumption_twh", "oil_share_energy_pct", "oil_per_capita_kwh"]].copy()
    frame["date"] = frame["year"].astype(int).astype(str) + "-12-31"
    base = frame.loc[frame["year"] == INDEX_YEAR].set_index("country")["oil_consumption_twh"]
    if set(base.index) != set(frame["country"]):
        raise ValueError(f"Every country needs a {INDEX_YEAR} consumption value to build the index")
    frame["consumption_index_2019"] = (frame["oil_consumption_twh"] / frame["country"].map(base) * 100).round(2)
    columns = ["date", "year", "country", "oil_consumption_twh", "consumption_index_2019",
               "oil_share_energy_pct", "oil_per_capita_kwh"]
    return frame[columns].sort_values(["country", "year"]).reset_index(drop=True)


def derive_country_map(frame: pd.DataFrame) -> pd.DataFrame:
    """Net balance where both production and consumption are reported; otherwise left missing."""
    frame = frame[["year", "iso_code", "country", "oil_production_twh", "oil_consumption_twh",
                   "oil_per_capita_kwh", "oil_share_energy_pct"]].copy()
    frame["date"] = frame["year"].astype(int).astype(str) + "-12-31"
    frame["net_balance_twh"] = (frame["oil_production_twh"] - frame["oil_consumption_twh"]).round(3)
    columns = ["date", "year", "iso_code", "country", "oil_production_twh", "oil_consumption_twh", "net_balance_twh",
               "oil_per_capita_kwh", "oil_share_energy_pct"]
    return frame[columns].sort_values(["iso_code", "year"]).reset_index(drop=True)


def derive_prices_daily(frame: pd.DataFrame) -> pd.DataFrame:
    """Day-on-day percentage change within each benchmark's own trading calendar."""
    frame = frame[["date", "benchmark", "price_usd_per_bbl"]].copy()
    frame = frame.sort_values(["benchmark", "date"]).reset_index(drop=True)
    previous = frame.groupby("benchmark")["price_usd_per_bbl"].shift(1)
    frame["change_1d_pct"] = ((frame["price_usd_per_bbl"] / previous - 1) * 100).round(3)
    return frame


DERIVE = {"prices_daily": derive_prices_daily, "prices": derive_prices, "regions": derive_regions, "countries": derive_countries,
          "country_map": derive_country_map}


# --------------------------------------------------------------------------- validate
def load_contract() -> dict:
    manifest = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    return {dataset["id"]: dataset for dataset in manifest["datasets"]}


def read_dataset(path: Path, spec: dict) -> pd.DataFrame:
    """Read a CSV with declared string columns kept as text; only empty fields are missing."""
    strings = {name: str for name, column in spec["columns"].items() if column["type"] in {"string", "date"}}
    return pd.read_csv(path, dtype=strings, keep_default_na=False, na_values=[""])


def validate(frame: pd.DataFrame, spec: dict) -> None:
    """Raise ValueError if the frame breaks any expectation declared in the manifest."""
    name, columns = spec["id"], spec["columns"]
    problems = []
    missing = set(columns).difference(frame.columns)
    if missing:
        raise ValueError(f"{name}: missing columns {sorted(missing)}")
    extra = set(frame.columns).difference(columns)
    if extra:
        problems.append(f"undeclared columns {sorted(extra)}")
    if len(frame) < spec.get("minimum_rows", 1):
        problems.append(f"only {len(frame)} rows; at least {spec['minimum_rows']} declared")
    keys = spec["primary_key"]
    if frame.duplicated(keys).any():
        problems.append(f"duplicate primary keys {keys}: {int(frame.duplicated(keys).sum())}")
    for column, rule in columns.items():
        series = frame[column]
        present = series.dropna()
        if not rule["nullable"] and series.isna().any():
            problems.append(f"{column}: {int(series.isna().sum())} missing values in a non-nullable column")
        if rule["type"] in {"integer", "number"}:
            numeric = pd.to_numeric(present, errors="coerce")
            if numeric.isna().any():
                problems.append(f"{column}: non-numeric values")
                continue
            if rule["type"] == "integer" and not (numeric % 1 == 0).all():
                problems.append(f"{column}: non-integer values")
            if "minimum" in rule and (numeric < rule["minimum"]).any():
                problems.append(f"{column}: values below {rule['minimum']} {rule.get('unit', '')}")
            if "maximum" in rule and (numeric > rule["maximum"]).any():
                problems.append(f"{column}: values above {rule['maximum']} {rule.get('unit', '')}")
        if rule["type"] == "date":
            dates = pd.to_datetime(present, errors="coerce", format="%Y-%m-%d")
            if dates.isna().any():
                problems.append(f"{column}: dates not in ISO YYYY-MM-DD form")
            if "date_minimum" in rule and (dates < pd.Timestamp(rule["date_minimum"])).any():
                problems.append(f"{column}: dates before {rule['date_minimum']}")
            if "date_maximum" in rule and (dates > pd.Timestamp(rule["date_maximum"])).any():
                problems.append(f"{column}: dates after {rule['date_maximum']}")
        if "allowed_values" in rule and not present.isin(rule["allowed_values"]).all():
            unexpected = sorted(set(present) - set(rule["allowed_values"]))
            problems.append(f"{column}: unexpected values {unexpected[:5]}")
    if spec.get("date_column") and spec.get("latest_observation"):
        latest = pd.to_datetime(frame[spec["date_column"]]).max().strftime("%Y-%m-%d")
        if latest != spec["latest_observation"]:
            problems.append(f"latest observation {latest} differs from manifest {spec['latest_observation']}")
    if problems:
        raise ValueError(f"{name} failed validation: " + "; ".join(problems))


def _cross_checks(frames: dict[str, pd.DataFrame]) -> None:
    """Checks that span columns: regional totals must reproduce the world total."""
    regions = frames["regions"]
    parts = regions.loc[regions["region"] != "World"].groupby("year")[["oil_production_twh", "oil_consumption_twh"]].sum()
    world = regions.loc[regions["region"] == "World"].set_index("year")[["oil_production_twh", "oil_consumption_twh"]]
    gap = (parts - world).abs().max().max()
    if gap > 1.0:
        raise ValueError(f"Regional oil totals differ from the world total by {gap:.2f} TWh")


# --------------------------------------------------------------------------- main
def build(sample_mode: bool) -> dict[str, pd.DataFrame]:
    contract = load_contract()
    if sample_mode:
        base = {name: read_dataset(ROOT / files[0], contract[name]) for name, files in DATASET_FILES.items()}
    else:
        if not RAW.exists() or not all((RAW / name).exists() for name in RAW_SOURCES):
            acquire()
        base = {"prices": transform_prices(), "regions": transform_regions(), "countries": transform_countries(),
                "country_map": transform_country_map(), "prices_daily": transform_prices_daily()}
    frames = {name: DERIVE[name](frame) for name, frame in base.items()}
    for name, frame in frames.items():
        validate(frame, contract[name])
    _cross_checks(frames)
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--acquire", action="store_true", help="Refresh data/raw/ and stop")
    parser.add_argument("--validate", action="store_true", help="Validate the processed outputs and stop")
    parser.add_argument("--refresh-sample", action="store_true", help="Live mode: also rewrite the bundled samples")
    args = parser.parse_args()
    sample_mode = os.getenv("DASHBOARD_SAMPLE_MODE", "0") == "1"
    if args.acquire or args.refresh_sample:
        if sample_mode:
            parser.error("Unset DASHBOARD_SAMPLE_MODE before acquiring live data")
    if args.acquire:
        acquire()
        return
    if args.validate:
        contract = load_contract()
        for name, (_, processed) in DATASET_FILES.items():
            validate(read_dataset(ROOT / processed, contract[name]), contract[name])
        print("Processed data valid")
        return
    frames = build(sample_mode)
    for name, frame in frames.items():
        sample, processed = DATASET_FILES[name]
        targets = [processed] + ([sample] if args.refresh_sample else [])
        for target in targets:
            path = ROOT / target
            path.parent.mkdir(parents=True, exist_ok=True)
            frame.to_csv(path, index=False)
            print(f"Validated and wrote {len(frame):,} rows to {target}")


if __name__ == "__main__":
    main()
