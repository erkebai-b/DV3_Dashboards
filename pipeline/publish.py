"""Refresh every dashboard dataset and publish it to ``public/data/`` for the web app.

Each dashboard keeps its own pipeline (``pipeline/<name>/src/data.py``) and data contract
(``pipeline/<name>/dashboard.yml``). This script runs them and copies the validated outputs
to the paths the Next.js front end fetches.

Modes
-----
``python pipeline/publish.py --check``
    Offline. Rebuilds every dataset from the bundled samples and validates it against the full
    contract, including the pinned latest-observation dates. Used by CI on every push.

``python pipeline/publish.py --live``
    Downloads the raw sources, transforms and validates them, then writes ``public/data/``.
    The contract is enforced in full except two fields that legitimately move when sources
    publish new data: ``latest_observation`` and ``date_maximum``. Every other rule (types,
    keys, missing values, allowed values, ranges, cross-dataset checks) still stops the run.
    Used by the scheduled GitHub Actions workflow; a failed run leaves the site on its last
    good data.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import importlib.util
import json
import os
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public" / "data"

# dashboard folder -> (web slug, {dataset id: published file name})
DASHBOARDS = {
    "oil_market": ("oil", {"prices": "prices.csv", "regions": "regions.csv", "countries": "countries.csv",
                           "country_map": "country_map.csv"}),
    "usa_elections_2026": ("elections", {"polls": "polls.csv", "seats": "seats.csv"}),
    "drone_industry": ("drones", {"comparison": "comparison.csv", "claims": "claims.csv",
                                  "platforms": "platforms.csv"}),
}


def load_pipeline(folder: str):
    """Import pipeline/<folder>/src/data.py under a unique module name."""
    path = HERE / folder / "src" / "data.py"
    spec = importlib.util.spec_from_file_location(f"pipeline_{folder}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def relax(contract: dict) -> dict:
    """Drop only the date fields that move forward when a source publishes new data."""
    relaxed = copy.deepcopy(contract)
    for dataset in relaxed.values():
        dataset.pop("latest_observation", None)
        for column in dataset["columns"].values():
            column.pop("date_maximum", None)
    return relaxed


def latest(frame: pd.DataFrame, spec: dict) -> str | None:
    column = spec.get("date_column")
    return None if not column else pd.to_datetime(frame[column]).max().strftime("%Y-%m-%d")


def run(folder: str, live: bool) -> dict:
    module = load_pipeline(folder)
    contract = module.load_contract()
    if live:
        module.acquire()
        module.load_contract = lambda: relax(contract)
        frames = module.build(sample_mode=False)
    else:
        os.environ["DASHBOARD_SAMPLE_MODE"] = "1"
        frames = module.build(sample_mode=True)
    slug, files = DASHBOARDS[folder]
    summary = {}
    for dataset_id, name in files.items():
        frame = frames[dataset_id]
        summary[dataset_id] = {"file": f"/data/{slug}/{name}", "rows": int(len(frame)),
                               "latest_observation": latest(frame, contract[dataset_id])}
        if live:
            target = PUBLIC / slug / name
            target.parent.mkdir(parents=True, exist_ok=True)
            frame.to_csv(target, index=False)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Offline rebuild and full validation from samples")
    mode.add_argument("--live", action="store_true", help="Refresh from live sources and publish to public/data")
    args = parser.parse_args()

    results, failures = {}, []
    for folder in DASHBOARDS:
        try:
            results[DASHBOARDS[folder][0]] = run(folder, live=args.live)
            print(f"[ok] {folder}: {results[DASHBOARDS[folder][0]]}")
        except (Exception, SystemExit) as error:  # noqa: BLE001 - report every dashboard, then fail
            failures.append(f"{folder}: {error}")
            print(f"[failed] {folder}: {error}", file=sys.stderr)

    if args.live and results:
        meta_path = PUBLIC / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"dashboards": {}}
        meta["dashboards"].update(results)
        meta["refreshed_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
        print(f"Wrote {meta_path}")
    if failures:
        sys.exit("Pipeline failures:\n" + "\n".join(failures))


if __name__ == "__main__":
    main()
