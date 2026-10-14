# DV3 Dashboards

Three evidence dashboards, each answering one question for a specific reader, with every number traced to who measured it.

| Dashboard | Question | Main sources |
|---|---|---|
| Oil market (`/oil`) | Where is oil demand still growing, who supplies it, and how have prices responded? | EIA spot prices; Energy Institute Statistical Review (via Our World in Data) |
| 2026 US elections (`/elections`) | How far can the polls be off, and which 2026 Senate seats are inside that range? | FiveThirtyEight poll and results archives; @unitedstates legislator roster |
| Drone losses (`/drones`) | What is claimed, what is verified, and which drone platforms dominate the record? | Ukraine General Staff claims (via Petro Ivaniuk); Oryx verified losses (via Lee Drake) |

## Architecture

```
GitHub Actions (daily)            GitHub repo                       Vercel
┌──────────────────────┐   commit  ┌──────────────────────┐  deploy  ┌───────────────────────┐
│ pipeline/publish.py  │ ────────▶ │ public/data/*.csv    │ ───────▶ │ Next.js static pages  │
│ acquire → transform  │           │ public/data/meta.json│          │ charts, filters and   │
│ → validate (contract)│           └──────────────────────┘          │ downloads in-browser  │
└──────────────────────┘                                              └───────────────────────┘
```

- **Pipelines** (`pipeline/<dashboard>/src/data.py`) acquire raw public data, shape it into tidy record-level tables and validate them against a data contract (`pipeline/<dashboard>/dashboard.yml`): column types, primary keys, missing values, allowed values, units and ranges, plus cross-checks such as regional oil totals reproducing the world total.
- **Refresh** (`.github/workflows/refresh-data.yml`) runs every day. If any validation fails, the job stops and the site keeps its last good data. Only two contract fields are relaxed for live refreshes because they legitimately move: the latest observation date and the maximum date.
- **CI** (`.github/workflows/ci.yml`) rebuilds every dataset offline from the bundled samples and validates it against the full contract, then lints and builds the site.
- **Front end**: Next.js 15 (App Router, statically prerendered), Vega-Lite charts, no backend. Filtering, headline findings and CSV downloads run in the browser from the published CSV files.

## Run locally

```bash
npm ci
npm run dev                                     # http://localhost:3000

python -m pip install -r pipeline/requirements.txt
python pipeline/publish.py --check              # offline validation from samples
python pipeline/publish.py --live               # refresh public/data from live sources
```

Requires Node 22 and Python 3.11.

## Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import this repository. The framework (Next.js) is detected automatically; no settings or environment variables are needed.
2. Every push to `main` deploys, including the daily data commits from the refresh workflow.

## Data and licences

Code: MIT (see `LICENSE`). Data stay under their publishers' terms:

- U.S. Energy Information Administration spot prices: public domain, via [DataHub core/oil-prices](https://github.com/datasets/oil-prices) (ODC-PDDL)
- Energy Institute, *Statistical Review of World Energy*, via [Our World in Data](https://github.com/owid/energy-data) (CC BY 4.0)
- [FiveThirtyEight](https://github.com/fivethirtyeight/data) pollster ratings and [election results](https://github.com/fivethirtyeight/election-results) (CC BY 4.0; archived)
- [@unitedstates congress-legislators](https://github.com/unitedstates/congress-legislators) (CC0)
- General Staff of the Armed Forces of Ukraine claims, structured by [Petro Ivaniuk](https://github.com/PetroIvaniuk/2022-Ukraine-Russia-War-Dataset) (MIT)
- [Oryx](https://www.oryxspioenkop.com/2022/02/attack-on-europe-documenting-equipment.html) verified losses, archived by [Lee Drake](https://github.com/leedrake5/Russia-Ukraine) (MIT)

## Known limits

- The FiveThirtyEight poll archive ends with 2022, and no 2026 polls or results are included.
- After the new Congress is sworn in on 3 January 2027, the 2026 seat list will no longer match the roster. The elections refresh will then fail validation by design: that dashboard keeps its last valid snapshot while the others continue to refresh.
- Oryx stopped listing reconnaissance UAVs after 3 May 2026, so the claimed-versus-verified comparison ends in April 2026.
