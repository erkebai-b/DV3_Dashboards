"""Acquire, transform and validate the drone-loss dashboard datasets (Russia–Ukraine war).

Two very different kinds of evidence are kept apart and compared, never merged:

* **Claims** — the General Staff of the Armed Forces of Ukraine's daily cumulative
  count of Russian drones (UAVs) it says were destroyed, as structured by Petro
  Ivaniuk's open dataset. One side's unverified claim; no platform breakdown.
* **Photo-verified losses** — Oryx's list of losses with photographic or video
  evidence for both sides, as archived daily by Lee Drake's tracker. A lower bound.

Pipeline stages:

* ``acquire()`` downloads raw files into ``data/raw/`` (live mode only);
* ``transform_claims()`` turns daily cumulative claims into calendar-month records;
* ``transform_comparison()`` lines up month-end claimed and verified UAV totals;
* ``transform_platforms()`` aggregates one Oryx snapshot to platform level;
* ``derive_*()`` recompute every derived column from base columns;
* ``validate()`` checks every dataset against ``dashboard.yml`` and stops on failure.

Usage::

    DASHBOARD_SAMPLE_MODE=1 python -m src.data      # offline rebuild (used by the checker)
    python -m src.data --acquire                    # refresh data/raw/ from the live sources
    python -m src.data                              # live transform from data/raw/
    python -m src.data --refresh-sample             # live transform, then rewrite the samples
    python -m src.data --validate                   # validate the processed outputs
"""

from __future__ import annotations

import argparse
import calendar
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
MANIFEST = ROOT / "dashboard.yml"

CLAIMS_URL = ("https://raw.githubusercontent.com/PetroIvaniuk/2022-Ukraine-Russia-War-Dataset/main/"
              "data/russia_losses_equipment.json")
TRACKER = "https://raw.githubusercontent.com/leedrake5/Russia-Ukraine/master/data/"
SNAPSHOT_DATE = "2026-05-03"           # last daily file in which Oryx still listed reconnaissance UAVs
COMPARISON_END = "2026-04-30"          # last month-end with consistent Oryx UAV categories
FIRST_MONTH = "2022-02"

CLAIM_CATEGORIES = {
    "drone": "Drones (UAVs)",
    "tank": "Tanks",
    "field artillery": "Artillery systems",
    "APC": "Armoured combat vehicles",
    "ground robotic systems": "Ground robotic systems",   # reported from 3 May 2026
}
UAV_CATEGORIES = [
    "Unmanned Aerial Vehicles",                    # single category used until November 2022
    "Reconnaissance Unmanned Aerial Vehicles",     # split out from November 2022 to May 2026
    "Unmanned Combat Aerial Vehicles",
]
# Airframes that the tracker's class lookup leaves unmapped but whose Oryx names identify them as
# uncrewed aircraft. Control stations, launchers and counter-UAV systems are deliberately excluded.
NAMED_UAV_AIRFRAMES = {
    "ZALA Z-16 (421-16<U+0415>)", "ZALA 421-16<U+0415>M", "ZALA Z-20", "Ptero-G0 'Kartograf'",
    "Eleron-10", "Eleron-3SV", "Albatros M5 reconnaissance UAV", "Bayraktar TB2", "Leleka-LR",
    "Shark-D", "Shark-M", "Mini Shark-D", "Punisher", "Quantum Vector UAV", "Raybird-3",
}
STATUSES = ["destroyed", "damaged", "abandoned", "captured"]

DATASET_FILES = {
    "comparison": ("data/sample.csv", "data/processed.csv"),
    "claims": ("data/sample_claims.csv", "data/processed_claims.csv"),
    "platforms": ("data/sample_platforms.csv", "data/processed_platforms.csv"),
}


# --------------------------------------------------------------------------- acquire
def _fetch(url: str, attempts: int = 5) -> bytes:
    """GET with a timeout, retrying rate limits (429) and server errors with exponential backoff."""
    for attempt in range(attempts):
        try:
            with urlopen(url, timeout=60) as response:
                return response.read()
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise
            wait = int(error.headers.get("Retry-After") or 0) or 2 ** (attempt + 1)
            time.sleep(min(wait, 60))
    raise RuntimeError("unreachable")


def _month_ends(start: str, end: str) -> list[pd.Timestamp]:
    return list(pd.date_range(f"{start}-01", end, freq="ME"))


def acquire() -> None:
    """Download claims, month-end Oryx category totals, one system-level snapshot and the class lookup."""
    (RAW / "byType").mkdir(parents=True, exist_ok=True)
    try:
        (RAW / "russia_losses_equipment.json").write_bytes(_fetch(CLAIMS_URL))
        for name in (f"bySystem/Raw/Full/{SNAPSHOT_DATE}.csv", "classes.csv"):
            (RAW / Path(name).name).write_bytes(_fetch(TRACKER + name))
        (RAW / "byType" / f"{SNAPSHOT_DATE}.csv").write_bytes(_fetch(f"{TRACKER}byType/{SNAPSHOT_DATE}.csv"))
        for month_end in _month_ends(FIRST_MONTH, COMPARISON_END):
            # The tracker writes one file per day; take the latest file in each month.
            for back in range(0, 8):
                day = (month_end - pd.Timedelta(days=back)).strftime("%Y-%m-%d")
                try:
                    body = _fetch(f"{TRACKER}byType/{day}.csv")
                except HTTPError as error:
                    if error.code == 404:
                        continue
                    raise
                (RAW / "byType" / f"{day}.csv").write_bytes(body)
                break
            else:
                sys.exit(f"No tracker file found in the last week of {month_end:%Y-%m}")
    except (URLError, TimeoutError, OSError) as error:
        sys.exit(f"Could not download a raw source: {error}. Check your connection, or run offline "
                 "with DASHBOARD_SAMPLE_MODE=1 to rebuild from the bundled samples.")
    print(f"Raw files written to {RAW}")


# --------------------------------------------------------------------------- transform
def _claims_daily() -> pd.DataFrame:
    records = json.loads((RAW / "russia_losses_equipment.json").read_text(encoding="utf-8"))
    daily = pd.DataFrame(records)
    daily["date"] = pd.to_datetime(daily["date"])
    return daily.sort_values("date")


def transform_claims() -> pd.DataFrame:
    """Cumulative claim at each complete calendar month's last report."""
    daily = _claims_daily()
    daily["month"] = daily["date"].dt.to_period("M")
    last = daily.groupby("month").tail(1)
    counts = daily.groupby("month").size()
    rows = []
    for _, record in last.iterrows():
        month_end = record["month"].to_timestamp(how="end").normalize()
        if (month_end - record["date"]).days > 1:      # incomplete (current) month
            continue
        for column, label in CLAIM_CATEGORIES.items():
            if pd.isna(record.get(column)):
                continue   # category not yet reported this month
            rows.append({
                "month_end": month_end.strftime("%Y-%m-%d"),
                "last_report_date": record["date"].strftime("%Y-%m-%d"),
                "category": label,
                "claimed_cumulative": int(record[column]),
                "reports_in_month": int(counts[record["month"]]),
            })
    return pd.DataFrame(rows)


def _oryx_month_end(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    frame = frame.loc[frame["country"].isin(["Russia", "Ukraine"]) & frame["equipment_type"].isin(UAV_CATEGORIES)]
    return frame.groupby("country")["type_total"].sum()


def transform_comparison(claims: pd.DataFrame) -> pd.DataFrame:
    """Month-end General Staff drone claim beside Oryx photo-verified UAV losses for each side."""
    drones = claims.loc[claims["category"] == "Drones (UAVs)"].set_index("month_end")
    files = pd.DataFrame({"path": sorted((RAW / "byType").glob("*.csv"))})
    files["snapshot"] = files["path"].map(lambda p: p.stem)
    files["month_end"] = files["snapshot"].map(lambda s: (pd.Timestamp(s) + pd.offsets.MonthEnd(0)).strftime("%Y-%m-%d"))
    files = files.sort_values("snapshot").groupby("month_end").tail(1)   # latest daily file in each month
    rows = []
    for path, snapshot, month_end in files[["path", "snapshot", "month_end"]].itertuples(index=False):
        if month_end > COMPARISON_END or month_end not in drones.index:
            continue
        totals = _oryx_month_end(path)
        rows.append({
            "month_end": month_end,
            "oryx_snapshot_date": snapshot,
            "claimed_russian_drones": int(drones.loc[month_end, "claimed_cumulative"]),
            "verified_russian_uavs": int(totals.get("Russia", 0)),
            "verified_ukrainian_uavs": int(totals.get("Ukraine", 0)),
        })
    frame = pd.DataFrame(rows)
    return frame.loc[frame["month_end"] >= "2022-03-31"].reset_index(drop=True)


def transform_platforms() -> pd.DataFrame:
    """Platform-level photo-verified UAV losses in the 3 May 2026 Oryx snapshot."""
    raw = pd.read_csv(RAW / f"{SNAPSHOT_DATE}.csv")
    classes = pd.read_csv(RAW / "classes.csv")[["system", "class"]].drop_duplicates("system")
    raw = raw.merge(classes, on="system", how="left")
    by_class = raw["class"].isin(UAV_CATEGORIES)
    by_name = raw["system"].isin(NAMED_UAV_AIRFRAMES) & ~by_class
    keep = raw.loc[by_class | by_name].copy()
    keep["identification_basis"] = by_class.loc[keep.index].map({True: "Oryx category", False: "Platform name"})
    keep["oryx_category"] = keep["class"].fillna("Not mapped by tracker")
    grouped = (keep.groupby(["country", "system", "origin", "oryx_category", "identification_basis", "status"])
                   .size().unstack("status", fill_value=0).reindex(columns=STATUSES, fill_value=0).reset_index())
    grouped = grouped.rename(columns={"country": "side", "system": "platform", "origin": "origin_country"})
    grouped["platform"] = grouped["platform"].str.replace("<U+0415>", "E", regex=False)
    grouped.insert(0, "snapshot_date", SNAPSHOT_DATE)
    return grouped


def oryx_category_totals() -> dict[str, int]:
    """Oryx's own UAV category totals on the snapshot date, for the coverage check."""
    totals = _oryx_month_end(RAW / "byType" / f"{SNAPSHOT_DATE}.csv") if (RAW / "byType" / f"{SNAPSHOT_DATE}.csv").exists() else None
    return {} if totals is None else {k: int(v) for k, v in totals.items()}


# --------------------------------------------------------------------------- derive
def derive_claims(frame: pd.DataFrame) -> pd.DataFrame:
    """Monthly claimed losses = change in the cumulative total since the previous month end."""
    frame = frame[["month_end", "last_report_date", "category", "claimed_cumulative", "reports_in_month"]].copy()
    frame = frame.sort_values(["category", "month_end"]).reset_index(drop=True)
    frame["claimed_in_month"] = frame.groupby("category")["claimed_cumulative"].diff()
    # A category's first month: only the war's first month starts from zero. A category added later
    # (ground robotic systems, May 2026) arrives with an unexplained running total, so its first month
    # is left missing rather than attributing the whole backlog to that month.
    first = frame.groupby("category")["month_end"].transform("min")
    from_start = first == frame["month_end"].min()
    frame.loc[(frame["month_end"] == first) & from_start, "claimed_in_month"] = frame["claimed_cumulative"]
    frame["claimed_in_month"] = frame["claimed_in_month"].astype("Int64")
    return frame


def derive_comparison(frame: pd.DataFrame) -> pd.DataFrame:
    """Claims per photo-verified loss, and each side's verified UAV losses added in the month."""
    base = ["month_end", "oryx_snapshot_date", "claimed_russian_drones", "verified_russian_uavs",
            "verified_ukrainian_uavs"]
    frame = frame[base].sort_values("month_end").reset_index(drop=True)
    frame["claims_per_verified_loss"] = (frame["claimed_russian_drones"] / frame["verified_russian_uavs"]).round(2)
    return frame


def derive_platforms(frame: pd.DataFrame) -> pd.DataFrame:
    """Total documented losses per platform and the share captured intact."""
    base = ["snapshot_date", "side", "platform", "origin_country", "oryx_category", "identification_basis", *STATUSES]
    frame = frame[base].copy()
    frame["total"] = frame[STATUSES].sum(axis=1).astype(int)
    return frame.sort_values(["side", "total", "platform"], ascending=[True, False, True]).reset_index(drop=True)


DERIVE = {"comparison": derive_comparison, "claims": derive_claims, "platforms": derive_platforms}


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
    """Checks spanning datasets: the comparison must reuse the claims series exactly."""
    claims = frames["claims"]
    drones = claims.loc[claims["category"] == "Drones (UAVs)"].set_index("month_end")["claimed_cumulative"]
    comparison = frames["comparison"].set_index("month_end")["claimed_russian_drones"]
    mismatch = (comparison - drones.reindex(comparison.index)).abs()
    if mismatch.isna().any() or mismatch.max() > 0:
        raise ValueError("Comparison claims differ from the claims dataset for some months")
    platforms = frames["platforms"]
    if (platforms["total"] != platforms[STATUSES].sum(axis=1)).any():
        raise ValueError("Platform totals do not equal the sum of their status counts")


def coverage_note(platforms: pd.DataFrame) -> None:
    """Live mode only: report how much of Oryx's own UAV total the platform list captures."""
    totals = oryx_category_totals()
    for side, total in totals.items():
        listed = int(platforms.loc[platforms["side"] == side, "total"].sum())
        print(f"Coverage check {side}: {listed} platform-level UAV losses vs {total} in Oryx UAV categories "
              f"({listed / total:.1%})")


# --------------------------------------------------------------------------- main
def build(sample_mode: bool) -> dict[str, pd.DataFrame]:
    contract = load_contract()
    if sample_mode:
        base = {name: read_dataset(ROOT / files[0], contract[name]) for name, files in DATASET_FILES.items()}
    else:
        if not RAW.exists() or not (RAW / "russia_losses_equipment.json").exists():
            acquire()
        claims = transform_claims()
        base = {"claims": claims, "comparison": transform_comparison(claims), "platforms": transform_platforms()}
        coverage_note(derive_platforms(base["platforms"]))
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
