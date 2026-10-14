"use client";

import { useMemo, useState } from "react";
import type { TopLevelSpec } from "vega-lite";
import { type Row, num, str, useDatasets } from "@/lib/data";
import { scaleFor } from "@/lib/palette";
import { fmt } from "@/lib/stats";
import { useDarkMode, VegaChart } from "@/components/VegaChart";
import { blues, choropleth, classify } from "@/lib/maps";
import { useIsoNumeric } from "@/lib/useIso";
import {
  ChipSelect, Controls, DownloadCsv, Empty, type Finding, Findings, Loading, Metric, Metrics, Provenance, RangeSelect, Segmented,
  Sources, Table, View,
} from "@/components/ui";

const SURPLUS = "#2a78d6";
const DEFICIT = "#eb6834";
const PRICE_COLS = ["date", "benchmark", "price_usd_per_bbl", "change_12m_pct"];
const REGION_COLS = ["date", "year", "region", "oil_production_twh", "oil_consumption_twh", "net_balance_twh",
  "share_of_world_production_pct", "share_of_world_consumption_pct"];
const COUNTRY_COLS = ["date", "year", "country", "oil_consumption_twh", "consumption_index_2019", "oil_share_energy_pct",
  "oil_per_capita_kwh"];
const MAP_COLS = ["date", "year", "iso_code", "country", "oil_production_twh", "oil_consumption_twh", "net_balance_twh",
  "oil_per_capita_kwh", "oil_share_energy_pct"];

const EIA = <><cite>Spot Prices for Crude Oil and Petroleum Products: Europe Brent (RBRTE) and Cushing, OK WTI (RWTC)</cite>, U.S. Energy Information Administration, via <a href="https://github.com/datasets/oil-prices">DataHub core/oil-prices</a> (ODC-PDDL).</>;
const EI = <><cite>Statistical Review of World Energy 2025</cite>, Energy Institute, compiled in <a href="https://github.com/owid/energy-data">Our World in Data energy dataset</a> (CC BY 4.0).</>;

export default function OilDashboard() {
  const state = useDatasets({
    prices: { path: "/data/oil/prices.csv", numeric: ["price_usd_per_bbl", "change_12m_pct"] },
    regions: { path: "/data/oil/regions.csv", numeric: REGION_COLS.slice(1).filter((c) => c !== "region") },
    countries: { path: "/data/oil/countries.csv", numeric: COUNTRY_COLS.slice(1).filter((c) => c !== "country") },
    countryMap: { path: "/data/oil/country_map.csv", numeric: ["year", "oil_production_twh", "oil_consumption_twh",
      "net_balance_twh", "oil_per_capita_kwh", "oil_share_energy_pct"] },
    daily: { path: "/data/oil/prices_daily.csv", numeric: ["price_usd_per_bbl", "change_1d_pct"] },
  });
  if (state.status !== "ready") return <Loading state={state} />;
  const { prices, regions, countries, countryMap, daily } = state.data;
  return (
    <>
      <Findings items={findings(prices, regions, countries, daily)} gaps={GAPS} />
      <RecentView daily={daily} />
      <DemandView countries={countries} />
      <BalanceView regions={regions} />
      <CountryMapView rows={countryMap} />
      <PriceView prices={prices} />
    </>
  );
}

const GAPS = [
  "Annual production and consumption stop at 2024. The Energy Institute's 2026 edition (covering 2025) appears on Our World in Data's website but not yet in the GitHub data file this site reads; the daily refresh will add 2025 automatically when it does.",
  "There is no monthly supply, demand or inventory series here yet (EIA STEO, IEA, JODI), so 2025–2026 price moves cannot be matched to physical balances. Adding them needs an EIA API key or another openly scriptable source.",
  "Prices are nominal spot prices; nothing on this page identifies the causes of price moves.",
];

function findings(prices: Row[], regions: Row[], countries: Row[], daily: Row[]): Finding[] {
  const world = countries.filter((r) => r.country === "World");
  const latestYear = Math.max(...world.map((r) => num(r, "year")));
  const w = (y: number) => world.find((r) => r.year === y)!;
  const change = Array.from(new Set(countries.map((r) => str(r, "country")))).filter((c) => c !== "World").map((c) => {
    const rows = countries.filter((r) => r.country === c);
    const at = (y: number) => num(rows.find((r) => r.year === y)!, "oil_consumption_twh");
    return { c, d: at(latestYear) - at(2019) };
  }).sort((a, b) => a.d - b.d);
  const lastYear = Math.max(...regions.map((r) => num(r, "year")));
  const reg = (name: string, year: number) => num(regions.find((r) => r.region === name && r.year === year)!, "net_balance_twh");
  const brentDaily = daily.filter((r) => r.benchmark === "Brent").sort((a, b) => str(a, "date").localeCompare(str(b, "date")));
  const first = brentDaily[0];
  const last = brentDaily.at(-1)!;
  const low = brentDaily.reduce((m, r) => (num(r, "price_usd_per_bbl") < num(m, "price_usd_per_bbl") ? r : m));
  const high = brentDaily.reduce((m, r) => (num(r, "price_usd_per_bbl") > num(m, "price_usd_per_bbl") ? r : m));
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return [
    { text: `Brent went from ${fmt.usd(num(first, "price_usd_per_bbl"))} on ${day(str(first, "date"))} to ${fmt.usd(num(last, "price_usd_per_bbl"))} on ${day(str(last, "date"))}. Its low in this period was ${fmt.usd(num(low, "price_usd_per_bbl"))} (${day(str(low, "date"))}) and its high ${fmt.usd(num(high, "price_usd_per_bbl"))} (${day(str(high, "date"))}).`,
      stars: 5, basis: "Measured EIA daily spot prices. They show what happened, not why." },
    { text: `World oil consumption in ${latestYear} was ${fmt.signed(num(w(latestYear), "consumption_index_2019") - 100)}% against 2019, while oil's share of primary energy moved from ${fmt.dec(num(w(2019), "oil_share_energy_pct"))}% to ${fmt.dec(num(w(latestYear), "oil_share_energy_pct"))}%. Demand is still growing in absolute terms even as its share edges down.`,
      stars: 4, basis: "Energy Institute estimates, revised each edition; cannot attribute the change to electrification." },
    { text: `Among the countries shown, the largest increase in consumption since 2019 was ${change.at(-1)!.c} (${fmt.signed(change.at(-1)!.d, 0)} TWh) and the largest fall was ${change[0].c} (${fmt.signed(change[0].d, 0)} TWh).`,
      stars: 4, basis: "Same Energy Institute series; country totals are well measured but revised." },
    { text: `Asia Pacific's net oil deficit reached ${fmt.int(Math.abs(reg("Asia Pacific", lastYear)))} TWh in ${lastYear}, up from ${fmt.int(Math.abs(reg("Asia Pacific", 2000)))} TWh in 2000. The Middle East remains the largest surplus region at ${fmt.int(reg("Middle East", lastYear))} TWh.`,
      stars: 4, basis: "Strong for direction; net balance is production minus consumption, not measured trade." },
  ];
}

/* ----------------------------------------------------------------------------- demand */
const DEMAND_MEASURES: Record<string, string> = {
  "Consumption index (2019 = 100)": "consumption_index_2019",
  "Oil share of primary energy (%)": "oil_share_energy_pct",
  "Oil use per person (kWh)": "oil_per_capita_kwh",
  "Oil consumption (TWh)": "oil_consumption_twh",
};

function DemandView({ countries }: { countries: Row[] }) {
  const dark = useDarkMode();
  const names = useMemo(() => {
    const all = Array.from(new Set(countries.map((r) => str(r, "country")))).sort();
    return ["World", ...all.filter((c) => c !== "World")];
  }, [countries]);
  const [chosen, setChosen] = useState(["World", "United States", "China", "India", "Japan", "Germany"]);
  const [measureLabel, setMeasure] = useState(Object.keys(DEMAND_MEASURES)[0]);
  const measure = DEMAND_MEASURES[measureLabel];
  const filtered = useMemo(() => countries.filter((r) => chosen.includes(str(r, "country"))), [countries, chosen]);
  const latest = Math.max(...countries.map((r) => num(r, "year")));
  const latestDate = countries.map((r) => str(r, "date")).sort().at(-1)!;

  const summary = names.filter((n) => chosen.includes(n)).map((n) => {
    const rows = filtered.filter((r) => r.country === n);
    const at = (y: number) => rows.find((r) => r.year === y)!;
    return {
      country: n, c2019: num(at(2019), "oil_consumption_twh"), cLatest: num(at(latest), "oil_consumption_twh"),
      change: num(at(latest), "consumption_index_2019") - 100,
      s2019: num(at(2019), "oil_share_energy_pct"), sLatest: num(at(latest), "oil_share_energy_pct"),
    };
  });

  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container", height: 340,
    data: { values: filtered },
    layer: [
      ...(measure === "consumption_index_2019" ? [{
        data: { values: [{ y: 100 }] }, mark: { type: "rule" as const, strokeDash: [4, 4], color: "#9aa3ad" },
        encoding: { y: { field: "y", type: "quantitative" as const } },
      }] : []),
      {
        mark: { type: "line" as const, point: { size: 22 } },
        encoding: {
          x: { field: "year", type: "ordinal" as const, title: null, axis: { labelAngle: 0, values: [2000, 2004, 2008, 2012, 2016, 2020, 2024] } },
          y: { field: measure, type: "quantitative" as const, title: measureLabel, scale: { zero: false } },
          color: { field: "country", type: "nominal" as const, scale: scaleFor(names.filter((n) => chosen.includes(n)), dark), legend: { title: null, orient: "top", columns: 4 } },
          tooltip: [{ field: "year", title: "Year" }, { field: "country", title: "Country" }, { field: measure, title: measureLabel, format: ",.1f" }],
        },
      },
    ],
  }), [filtered, measure, measureLabel, names, chosen, dark]);

  return (
    <View id="demand" title="Is oil demand bending?" unit="Index (2019 = 100) of oil consumption; percent of primary energy (substitution method); kilowatt-hours per person; terawatt-hours (TWh).">
      <Provenance by="Energy Institute, via Our World in Data" status="estimated" latest={latestDate} note="calendar-year values" />
      <Controls>
        <ChipSelect label="Countries" options={names} value={chosen} onChange={setChosen} max={8} />
        <Segmented label="Measure" options={Object.keys(DEMAND_MEASURES)} value={measureLabel} onChange={setMeasure} />
      </Controls>
      {filtered.length === 0 ? <Empty>No countries selected. Choose at least one country to compare.</Empty> : (
        <>
          <Metrics>
            {summary.slice(0, 6).map((s) => (
              <Metric key={s.country} label={`${s.country}: consumption vs 2019`} value={`${fmt.signed(s.change)}%`} note={`oil share ${fmt.signed(s.sLatest - s.s2019)} pts`} />
            ))}
          </Metrics>
          <VegaChart spec={spec} label={`${measureLabel} by country, 2000–${latest}`} height={380} />
          <Table caption="Consumption and oil share, 2019 versus latest year" rows={summary} columns={[
            { key: "country", label: "Country" },
            { key: "c2019", label: "Consumption 2019 (TWh)", align: "right", format: (v) => fmt.int(v as number) },
            { key: "cLatest", label: `Consumption ${latest} (TWh)`, align: "right", format: (v) => fmt.int(v as number) },
            { key: "change", label: `Change 2019–${latest}`, align: "right", format: (v) => `${fmt.signed(v as number)}%` },
            { key: "s2019", label: "Oil share 2019", align: "right", format: (v) => `${fmt.dec(v as number)}%` },
            { key: "sLatest", label: `Oil share ${latest}`, align: "right", format: (v) => `${fmt.dec(v as number)}%` },
          ]} />
        </>
      )}
      <Sources>
        <p>{EI}</p>
        <p>Consumption above its 2019 level means demand has not been bent in absolute terms; a falling oil share with rising consumption means other energy grew faster. These series cannot attribute changes to electrification specifically, since prices, income and the pandemic also moved demand.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={COUNTRY_COLS} fileName="oil_demand_by_country.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- balance */
const BALANCE_MEASURES: Record<string, string> = {
  "Net balance": "net_balance_twh",
  Production: "oil_production_twh",
  Consumption: "oil_consumption_twh",
  "Share of world consumption (%)": "share_of_world_consumption_pct",
};

function BalanceView({ regions }: { regions: Row[] }) {
  const dark = useDarkMode();
  const all = useMemo(() => {
    const names = Array.from(new Set(regions.map((r) => str(r, "region")))).sort();
    return [...names.filter((n) => n !== "World"), "World"];
  }, [regions]);
  const years = useMemo(() => Array.from(new Set(regions.map((r) => String(r.year)))).sort(), [regions]);
  const [chosen, setChosen] = useState(all.filter((n) => n !== "World"));
  const [span, setSpan] = useState<[string, string]>([years[0], years.at(-1)!]);
  const [measureLabel, setMeasure] = useState(Object.keys(BALANCE_MEASURES)[0]);
  const measure = BALANCE_MEASURES[measureLabel];
  const filtered = useMemo(() => regions.filter((r) => chosen.includes(str(r, "region"))
    && num(r, "year") >= Number(span[0]) && num(r, "year") <= Number(span[1])), [regions, chosen, span]);
  const endYear = Number(span[1]);
  const startYear = Number(span[0]);
  const end = filtered.filter((r) => r.year === endYear && r.region !== "World");
  const latestDate = regions.map((r) => str(r, "date")).sort().at(-1)!;

  const top = [...end].sort((a, b) => num(b, "net_balance_twh") - num(a, "net_balance_twh"));
  const shift = end.map((r) => {
    const start = filtered.find((s) => s.region === r.region && s.year === startYear);
    return start ? { region: str(r, "region"), d: num(r, "net_balance_twh") - num(start, "net_balance_twh") } : null;
  }).filter(Boolean).sort((a, b) => Math.abs(b!.d) - Math.abs(a!.d))[0];

  const lineSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container", height: 320, data: { values: filtered },
    mark: { type: "line" },
    encoding: {
      x: { field: "year", type: "quantitative", title: null, axis: { format: "d", tickCount: 10 } },
      y: { field: measure, type: "quantitative", title: measure.endsWith("pct") ? measureLabel : `${measureLabel} (TWh)` },
      color: { field: "region", type: "nominal", scale: scaleFor(all, dark), legend: { title: null, orient: "top", columns: 4, values: chosen } },
      tooltip: [{ field: "year", title: "Year" }, { field: "region", title: "Region" }, { field: measure, title: measureLabel, format: ",.1f" }],
    },
  }), [filtered, measure, measureLabel, all, chosen, dark]);

  const barSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container", height: { step: 30 }, data: { values: end },
    mark: { type: "bar", cornerRadiusEnd: 4, height: 18 },
    encoding: {
      y: { field: "region", type: "nominal", sort: "-x", title: null },
      x: { field: "net_balance_twh", type: "quantitative", title: "TWh" },
      color: { condition: { test: "datum.net_balance_twh >= 0", value: SURPLUS }, value: DEFICIT },
      tooltip: [{ field: "region" }, { field: "net_balance_twh", title: "Net TWh", format: "+,.0f" },
        { field: "oil_production_twh", title: "Production TWh", format: ",.0f" }, { field: "oil_consumption_twh", title: "Consumption TWh", format: ",.0f" }],
    },
  }), [end]);

  return (
    <View id="balance" title="Regional oil production, consumption and net balance" unit="Terawatt-hours (TWh) of primary energy per year; shares in percent of the world total. Net balance = production − consumption.">
      <Provenance by="Energy Institute, via Our World in Data" status="estimated" latest={latestDate} note="calendar-year totals" />
      <Controls>
        <ChipSelect label="Regions" options={all} value={chosen} onChange={setChosen} />
        <RangeSelect label="Years" options={years} value={span} onChange={setSpan} />
        <Segmented label="Measure" options={Object.keys(BALANCE_MEASURES)} value={measureLabel} onChange={setMeasure} />
      </Controls>
      {filtered.length === 0 ? <Empty>No regions selected. Choose at least one region to see its balance.</Empty> : (
        <>
          {top.length > 0 && (
            <Metrics>
              <Metric label={`Largest net surplus, ${endYear}`} value={str(top[0], "region")} note={`${fmt.signed(num(top[0], "net_balance_twh"), 0)} TWh`} />
              <Metric label={`Largest net deficit, ${endYear}`} value={str(top.at(-1)!, "region")} note={`${fmt.signed(num(top.at(-1)!, "net_balance_twh"), 0)} TWh`} />
              {shift && startYear !== endYear && <Metric label={`Biggest shift, ${startYear}–${endYear}`} value={shift.region} note={`${fmt.signed(shift.d, 0)} TWh`} />}
            </Metrics>
          )}
          <VegaChart spec={lineSpec} label={`${measureLabel} by region, ${startYear}–${endYear}`} height={360} />
          {end.length > 0 && (
            <>
              <h3>Net balance by region in {endYear}</h3>
              <p className="muted small">Right of zero: the region produces more oil than it consumes.</p>
              <VegaChart spec={barSpec} label={`Net balance by region in ${endYear}`} />
            </>
          )}
        </>
      )}
      <Sources>
        <p>{EI}</p>
        <p>Consumption is inland demand plus international aviation and marine bunkers and refinery fuel and loss; it excludes ethanol and biodiesel. World consumption exceeds world production in this series; the Energy Institute attributes such differences to stock changes, non-petroleum additives and substitute fuels, and differences in definition and measurement. A net balance indicates dependence on trade, not a measured trade flow.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={REGION_COLS} fileName="oil_regional_balance.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- prices */
const BENCHMARKS = ["Brent", "WTI"];

function PriceView({ prices }: { prices: Row[] }) {
  const dark = useDarkMode();
  
  const months = useMemo(() => Array.from(new Set(prices.map((r) => str(r, "date")))).sort(), [prices]);
  const [chosen, setChosen] = useState(BENCHMARKS);
  const [period, setPeriod] = useState<[string, string]>([months[0], months.at(-1)!]);
  const filtered = useMemo(() => prices.filter((r) => chosen.includes(str(r, "benchmark"))
    && str(r, "date") >= period[0] && str(r, "date") <= period[1]), [prices, chosen, period]);

  const stats = chosen.map((b) => {
    const rows = filtered.filter((r) => r.benchmark === b).sort((x, y) => str(x, "date").localeCompare(str(y, "date")));
    if (!rows.length) return null;
    const peak = rows.reduce((m, r) => (num(r, "price_usd_per_bbl") > num(m, "price_usd_per_bbl") ? r : m));
    return { b, latest: rows.at(-1)!, peak };
  }).filter(Boolean) as { b: string; latest: Row; peak: Row }[];

  const lineSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container", height: 320, data: { values: filtered },
    encoding: { x: { field: "date", type: "temporal", title: null } },
    layer: [
      {
        mark: { type: "line" },
        encoding: {
          y: { field: "price_usd_per_bbl", type: "quantitative", title: "US dollars per barrel" },
          color: { field: "benchmark", type: "nominal", scale: scaleFor(BENCHMARKS, dark), legend: { title: null, orient: "top" } },
        },
      },
      {
        params: [{ name: "hover", select: { type: "point", fields: ["date"], nearest: true, on: "pointerover", clear: "pointerout" } }],
        mark: { type: "point", size: 60, filled: true },
        encoding: {
          y: { field: "price_usd_per_bbl", type: "quantitative" },
          color: { field: "benchmark", type: "nominal", scale: scaleFor(BENCHMARKS, dark), legend: null },
          opacity: { condition: { param: "hover", empty: false, value: 1 }, value: 0 },
          tooltip: [{ field: "date", type: "temporal", title: "Month", format: "%b %Y" }, { field: "benchmark", title: "Benchmark" },
            { field: "price_usd_per_bbl", title: "US$/bbl", format: ",.2f" }, { field: "change_12m_pct", title: "12-month change %", format: "+.1f" }],
        },
      },
    ],
  }), [filtered, dark]);

  const spread = useMemo(() => {
    if (chosen.length < 2) return [];
    const byDate = new Map<string, Record<string, number>>();
    for (const r of filtered) {
      const entry = byDate.get(str(r, "date")) ?? {};
      entry[str(r, "benchmark")] = num(r, "price_usd_per_bbl");
      byDate.set(str(r, "date"), entry);
    }
    return Array.from(byDate.entries()).filter(([, v]) => v.Brent !== undefined && v.WTI !== undefined)
      .map(([date, v]) => ({ date, spread: Math.round((v.Brent - v.WTI) * 100) / 100 }));
  }, [filtered, chosen]);

  const spreadSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container", height: 150, data: { values: spread },
    mark: { type: "bar" },
    encoding: {
      x: { field: "date", type: "temporal", title: null },
      y: { field: "spread", type: "quantitative", title: "US$/bbl" },
      color: { condition: { test: "datum.spread >= 0", value: SURPLUS }, value: DEFICIT },
      tooltip: [{ field: "date", type: "temporal", format: "%b %Y", title: "Month" }, { field: "spread", format: "+.2f", title: "Brent − WTI" }],
    },
  }), [spread]);

  return (
    <View id="prices" title="Brent and WTI monthly spot prices" unit="US dollars per barrel, nominal; monthly average of daily spot prices.">
      <Provenance by="U.S. Energy Information Administration" status="observed" latest={months.at(-1)!} note="monthly average for that month" />
      <Controls>
        <ChipSelect label="Benchmarks" options={BENCHMARKS} value={chosen} onChange={setChosen} />
        <RangeSelect label="Period" options={months} value={period} onChange={setPeriod} format={fmt.month} />
      </Controls>
      {filtered.length === 0 ? <Empty>No benchmark selected. Choose Brent, WTI or both.</Empty> : (
        <>
          <Metrics>
            {stats.flatMap(({ b, latest, peak }) => [
              <Metric key={`${b}-l`} label={`${b}, ${fmt.month(str(latest, "date"))}`} value={fmt.usd(num(latest, "price_usd_per_bbl"))}
                note={latest.change_12m_pct === null ? undefined : `${fmt.signed(num(latest, "change_12m_pct"))}% vs 12 months earlier`} />,
              <Metric key={`${b}-p`} label={`${b} peak in period`} value={fmt.usd(num(peak, "price_usd_per_bbl"))} note={fmt.month(str(peak, "date"))} />,
            ])}
          </Metrics>
          <VegaChart spec={lineSpec} label="Monthly Brent and WTI spot prices" height={360} />
          {spread.length > 0 && (
            <>
              <h3>Brent minus WTI spread</h3>
              <p className="muted small">US dollars per barrel; above zero means Brent traded at a premium.</p>
              <VegaChart spec={spreadSpec} label="Brent minus WTI spread by month" height={180} />
            </>
          )}
        </>
      )}
      <Sources>
        <p>{EIA}</p>
        <p>Nominal prices, not adjusted for inflation. Monthly averages smooth intra-month extremes: WTI&apos;s daily spot price of −US$36.98 on 20 April 2020 sits inside an April 2020 monthly average of US$16.55.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={PRICE_COLS} fileName="oil_spot_prices.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- 2024–2026 daily */
const DAILY_COLS = ["date", "benchmark", "price_usd_per_bbl", "change_1d_pct"];

function stdev(values: number[]) {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

function RecentView({ daily }: { daily: Row[] }) {
  const dark = useDarkMode();
  const months = useMemo(() => Array.from(new Set(daily.map((r) => str(r, "date").slice(0, 7)))).sort(), [daily]);
  const [chosen, setChosen] = useState(BENCHMARKS);
  const [period, setPeriod] = useState<[string, string]>([months[0], months.at(-1)!]);
  const filtered = useMemo(() => daily.filter((r) => chosen.includes(str(r, "benchmark"))
    && str(r, "date").slice(0, 7) >= period[0] && str(r, "date").slice(0, 7) <= period[1]), [daily, chosen, period]);
  const latestDate = daily.map((r) => str(r, "date")).sort().at(-1)!;

  const stats = chosen.map((b) => {
    const rows = filtered.filter((r) => r.benchmark === b).sort((x, y) => str(x, "date").localeCompare(str(y, "date")));
    if (rows.length < 2) return null;
    const first = rows[0];
    const last = rows.at(-1)!;
    let peak = num(rows[0], "price_usd_per_bbl");
    let drawdown = 0;
    for (const r of rows) {
      peak = Math.max(peak, num(r, "price_usd_per_bbl"));
      drawdown = Math.min(drawdown, num(r, "price_usd_per_bbl") / peak - 1);
    }
    const recent = rows.slice(-21).map((r) => r.change_1d_pct).filter((v): v is number => typeof v === "number");
    const vol = recent.length > 2 ? stdev(recent) * Math.sqrt(252) : NaN;
    return { b, first, last, change: (num(last, "price_usd_per_bbl") / num(first, "price_usd_per_bbl") - 1) * 100, drawdown: drawdown * 100, vol, rows };
  }).filter(Boolean) as { b: string; first: Row; last: Row; change: number; drawdown: number; vol: number; rows: Row[] }[];

  const moves = useMemo(() => [...filtered].filter((r) => r.change_1d_pct !== null)
    .sort((a, b) => Math.abs(num(b, "change_1d_pct")) - Math.abs(num(a, "change_1d_pct"))).slice(0, 8), [filtered]);

  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 320, data: { values: filtered },
    encoding: { x: { field: "date", type: "temporal", title: null, axis: { format: "%b %Y" } } },
    layer: [
      { mark: { type: "line", strokeWidth: 1.6 },
        encoding: { y: { field: "price_usd_per_bbl", type: "quantitative", title: "US dollars per barrel", scale: { zero: false } },
          color: { field: "benchmark", type: "nominal", scale: scaleFor(BENCHMARKS, dark), legend: { title: null, orient: "top" } } } },
      { params: [{ name: "hover", select: { type: "point", fields: ["date"], nearest: true, on: "pointerover", clear: "pointerout" } }],
        mark: { type: "point", size: 50, filled: true },
        encoding: { y: { field: "price_usd_per_bbl", type: "quantitative" },
          color: { field: "benchmark", type: "nominal", scale: scaleFor(BENCHMARKS, dark), legend: null },
          opacity: { condition: { param: "hover", empty: false, value: 1 }, value: 0 },
          tooltip: [{ field: "date", type: "temporal", title: "Date", format: "%d %b %Y" }, { field: "benchmark" },
            { field: "price_usd_per_bbl", title: "US$/bbl", format: ",.2f" }, { field: "change_1d_pct", title: "Day change %", format: "+.2f" }] } },
    ],
  }), [filtered, dark]);

  const changeSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 140,
    data: { values: filtered.filter((r) => r.benchmark === (chosen.includes("Brent") ? "Brent" : "WTI") && r.change_1d_pct !== null) },
    mark: { type: "bar", width: 1.2 },
    encoding: {
      x: { field: "date", type: "temporal", title: null, axis: { format: "%b %Y" } },
      y: { field: "change_1d_pct", type: "quantitative", title: "Day change %" },
      color: { condition: { test: "datum.change_1d_pct >= 0", value: SURPLUS }, value: DEFICIT },
      tooltip: [{ field: "date", type: "temporal", format: "%d %b %Y", title: "Date" }, { field: "change_1d_pct", title: "Day change %", format: "+.2f" }],
    },
  }), [filtered, chosen]);

  return (
    <View id="recent" title="2024–2026 up close: daily Brent and WTI" unit="US dollars per barrel, nominal daily spot price; daily change in percent; volatility annualised from the last 21 trading days.">
      <Provenance by="U.S. Energy Information Administration" status="observed" latest={latestDate} note="each benchmark on its own trading days" />
      <Controls>
        <ChipSelect label="Benchmarks" options={BENCHMARKS} value={chosen} onChange={setChosen} />
        <RangeSelect label="Period" options={months} value={period} onChange={setPeriod} format={(m) => fmt.month(`${m}-01`)} />
      </Controls>
      {filtered.length === 0 ? <Empty>No benchmark selected. Choose Brent, WTI or both.</Empty> : (
        <>
          <Metrics>
            {stats.flatMap((st) => [
              <Metric key={`${st.b}-c`} label={`${st.b}: change over period`} value={`${fmt.signed(st.change)}%`}
                note={`${fmt.usd(num(st.first, "price_usd_per_bbl"))} → ${fmt.usd(num(st.last, "price_usd_per_bbl"))}`} />,
              <Metric key={`${st.b}-d`} label={`${st.b}: deepest fall from a peak`} value={`${fmt.dec(st.drawdown)}%`} />,
              <Metric key={`${st.b}-v`} label={`${st.b}: recent volatility`} value={`${fmt.dec(st.vol, 0)}%`} note="annualised, last 21 trading days" />,
            ])}
          </Metrics>
          <VegaChart spec={spec} label="Daily Brent and WTI spot prices since January 2024" height={360} />
          <h3>Day-to-day moves ({chosen.includes("Brent") ? "Brent" : "WTI"})</h3>
          <p className="muted small">Each bar is one trading day&apos;s percentage change. Clusters of tall bars mark turbulent stretches.</p>
          <VegaChart spec={changeSpec} label="Daily percentage change in the oil price" height={170} />
          <h3>Largest single-day moves in the selection</h3>
          <Table caption="Largest single-day price moves" maxHeight={300} rows={moves} columns={[
            { key: "date", label: "Date" }, { key: "benchmark", label: "Benchmark" },
            { key: "price_usd_per_bbl", label: "Price (US$/bbl)", align: "right", format: (v) => fmt.dec(v as number, 2) },
            { key: "change_1d_pct", label: "Day change", align: "right", format: (v) => `${fmt.signed(v as number, 2)}%` },
          ]} />
        </>
      )}
      <Sources>
        <p>{EIA}</p>
        <p>The data record when prices moved, not why. Matching these dates to events (supply decisions, conflicts, sanctions, shipping disruptions) needs separate, cited sources.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={DAILY_COLS} fileName="oil_daily_prices_2024_2026.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- country map */
const MAP_MEASURES: Record<string, { field: string; unit: string }> = {
  "Net balance": { field: "net_balance_twh", unit: "TWh" },
  Production: { field: "oil_production_twh", unit: "TWh" },
  Consumption: { field: "oil_consumption_twh", unit: "TWh" },
  "Use per person": { field: "oil_per_capita_kwh", unit: "kWh per person" },
  "Share of energy": { field: "oil_share_energy_pct", unit: "% of primary energy" },
};
const NET_BREAKS = [-2000, -500, -100, 0, 100, 500, 2000];
const NET_LABELS = ["Imports > 2,000", "Imports 500–2,000", "Imports 100–500", "Imports < 100",
  "Exports < 100", "Exports 100–500", "Exports 500–2,000", "Exports > 2,000"];
const NET_COLORS = ["#a8410f", "#d95926", "#f0a37f", "#f6d5c4", "#c3d9f3", "#6da7ec", "#256abf", "#0d366b"];

function CountryMapView({ rows }: { rows: Row[] }) {
  const dark = useDarkMode();
  const iso = useIsoNumeric();
  const years = useMemo(() => Array.from(new Set(rows.map((r) => String(r.year)))).sort(), [rows]);
  const [year, setYear] = useState(years.at(-1)!);
  const [measureLabel, setMeasure] = useState("Net balance");
  const measure = MAP_MEASURES[measureLabel];
  const filtered = useMemo(() => rows.filter((r) => String(r.year) === year), [rows, year]);
  const reported = filtered.filter((r) => r[measure.field] !== null);

  const mapRows = useMemo(() => (iso ? filtered.filter((r) => iso[str(r, "iso_code")] && r[measure.field] !== null)
    .map((r) => ({ ...r, id: iso[str(r, "iso_code")], value: r[measure.field],
      netClass: r.net_balance_twh === null ? null : classify(num(r, "net_balance_twh"), NET_BREAKS, NET_LABELS) })) : []),
  [filtered, iso, measure.field]);

  const color = measure.field === "net_balance_twh"
    ? { field: "netClass", type: "nominal", title: "Net balance, TWh per year",
        scale: { domain: NET_LABELS, range: NET_COLORS },
        legend: { orient: "bottom", direction: "horizontal", columns: 4, symbolType: "square", labelLimit: 160 } }
    : { field: "value", type: "quantitative", title: `${measureLabel} (${measure.unit})`,
        scale: { type: measure.field === "oil_share_energy_pct" ? "linear" : "log", range: blues(dark) },
        legend: { orient: "bottom", direction: "horizontal", gradientLength: 320, format: "~s" } };

  const spec = useMemo(() => choropleth({
    url: "/geo/world-110m.json", feature: "countries", projection: "equalEarth", rows: mapRows, height: 440, dark,
    fields: ["value", "country", "oil_production_twh", "oil_consumption_twh", "net_balance_twh", "netClass"],
    color,
    tooltip: [{ field: "country", title: "Country" }, { field: "value", title: `${measureLabel} (${measure.unit})`, format: ",.1f" },
      { field: "oil_production_twh", title: "Production (TWh)", format: ",.0f" },
      { field: "oil_consumption_twh", title: "Consumption (TWh)", format: ",.0f" }],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [mapRows, dark, measureLabel]);

  const net = filtered.filter((r) => r.net_balance_twh !== null).sort((a, b) => num(b, "net_balance_twh") - num(a, "net_balance_twh"));
  const consumers = filtered.filter((r) => r.oil_consumption_twh !== null).length;

  return (
    <View id="country-map" title="Who produces more oil than they consume? Country map" unit="Terawatt-hours (TWh) per year for production, consumption and net balance; kilowatt-hours per person; percent of primary energy.">
      <Provenance by="Energy Institute, via Our World in Data" status="estimated" latest={rows.map((r) => str(r, "date")).sort().at(-1)!} note="calendar-year values; map starts in 2017" />
      <Controls>
        <RangeSelectSingle label="Year" options={years} value={year} onChange={setYear} />
        <Segmented label="Measure" options={Object.keys(MAP_MEASURES)} value={measureLabel} onChange={setMeasure} />
      </Controls>
      {net.length > 0 && (
        <Metrics>
          <Metric label={`Largest net exporter, ${year}`} value={str(net[0], "country")} note={`${fmt.signed(num(net[0], "net_balance_twh"), 0)} TWh`} />
          <Metric label={`Largest net importer, ${year}`} value={str(net.at(-1)!, "country")} note={`${fmt.signed(num(net.at(-1)!, "net_balance_twh"), 0)} TWh`} />
          <Metric label="Countries shown for this measure" value={`${reported.length}`} note={measure.field === "net_balance_twh" ? `of ${consumers} with consumption reported` : undefined} />
        </Metrics>
      )}
      {iso === null ? <p className="loading">Loading map…</p> : <VegaChart spec={spec} label={`World map of ${measureLabel.toLowerCase()} in ${year}`} height={500} />}
      <p className="muted small">Grey: not separately reported by the Energy Institute for this measure. The Statistical Review lists production only for larger producers, so net balance appears where both production and consumption are listed; it is never assumed to be zero.</p>
      <Sources>
        <p>{EI}</p>
        <p>Before 2017 Our World in Data fills country production from a second source, so the map starts in 2017 to keep a single source. Boundaries: Natural Earth via world-atlas (public domain); they are illustrative and imply no position on disputed territories.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={MAP_COLS} fileName={`oil_by_country_${year}.csv`} />
    </View>
  );
}

function RangeSelectSingle({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="control">
      <span className="legend">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
