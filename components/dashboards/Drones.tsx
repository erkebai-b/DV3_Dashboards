"use client";

import { useMemo, useState } from "react";
import type { TopLevelSpec } from "vega-lite";
import { type Row, num, str, useDatasets } from "@/lib/data";
import { PALETTE_DARK, PALETTE_LIGHT } from "@/lib/palette";
import { fmt } from "@/lib/stats";
import { useDarkMode, VegaChart } from "@/components/VegaChart";
import {
  ChipSelect, Controls, DownloadCsv, Empty, Findings, Loading, Metric, Metrics, Provenance, RangeSelect, Segmented,
  Sources, Table, View,
} from "@/components/ui";

const CATEGORIES = ["Drones (UAVs)", "Tanks", "Artillery systems", "Armoured combat vehicles"];
const STATUSES = ["destroyed", "damaged", "abandoned", "captured"];
const COMPARISON_COLS = ["month_end", "oryx_snapshot_date", "claimed_russian_drones", "verified_russian_uavs",
  "verified_ukrainian_uavs", "claims_per_verified_loss"];
const CLAIM_COLS = ["month_end", "last_report_date", "category", "claimed_cumulative", "reports_in_month", "claimed_in_month"];
const PLATFORM_COLS = ["snapshot_date", "side", "platform", "origin_country", "oryx_category", "identification_basis",
  ...STATUSES, "total"];
const CLAIMED = "Claimed by Ukraine's General Staff";
const VERIFIED = "Photo-verified by Oryx";

const CLAIMS_SOURCE = <><cite>Daily reports on Russian combat losses</cite>, General Staff of the Armed Forces of Ukraine, structured in <a href="https://github.com/PetroIvaniuk/2022-Ukraine-Russia-War-Dataset">Russian equipment losses (2022 Ukraine Russia War Dataset)</a> by Petro Ivaniuk (MIT).</>;
const ORYX_SOURCE = <><cite>Attack On Europe: Documenting Equipment Losses</cite>, <a href="https://www.oryxspioenkop.com/2022/02/attack-on-europe-documenting-equipment.html">Oryx</a>, archived daily in <a href="https://github.com/leedrake5/Russia-Ukraine">Oryx equipment loss archive (leedrake5/Russia-Ukraine)</a> by Lee Drake (MIT).</>;

export default function DronesDashboard() {
  const state = useDatasets({
    comparison: { path: "/data/drones/comparison.csv", numeric: ["claimed_russian_drones", "verified_russian_uavs", "verified_ukrainian_uavs", "claims_per_verified_loss"] },
    claims: { path: "/data/drones/claims.csv", numeric: ["claimed_cumulative", "reports_in_month", "claimed_in_month"] },
    platforms: { path: "/data/drones/platforms.csv", numeric: [...STATUSES, "total"] },
  });
  if (state.status !== "ready") return <Loading state={state} />;
  const { comparison, claims, platforms } = state.data;
  return (
    <>
      <Findings items={findings(comparison, claims, platforms)} />
      <ComparisonView comparison={comparison} />
      <ClaimsView claims={claims} />
      <PlatformView platforms={platforms} comparison={comparison} />
    </>
  );
}

const yearEarlier = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

function findings(comparison: Row[], claims: Row[], platforms: Row[]): string[] {
  const drones = claims.filter((r) => r.category === "Drones (UAVs)");
  const latest = drones.map((r) => str(r, "month_end")).sort().at(-1)!;
  const at = (cat: string, m: string) => num(claims.find((r) => r.category === cat && r.month_end === m)!, "claimed_in_month");
  const now = at("Drones (UAVs)", latest);
  const prior = at("Drones (UAVs)", yearEarlier(latest));
  const first = comparison[0];
  const last = comparison.at(-1)!;
  const russia = platforms.filter((r) => r.side === "Russia").sort((a, b) => num(b, "total") - num(a, "total"));
  const total = russia.reduce((s, r) => s + num(r, "total"), 0);
  const top3 = russia.slice(0, 3);
  return [
    `Ukraine's General Staff claimed ${fmt.int(now)} Russian drones destroyed in ${fmt.monthLong(latest)}, ${fmt.dec(now / prior)}× the figure for ${fmt.monthLong(yearEarlier(latest))} and ${fmt.int(now / Math.max(at("Tanks", latest), 1))}× its tank claim for the same month.`,
    `Claims per photo-verified Russian UAV loss rose from ${fmt.dec(num(first, "claims_per_verified_loss"))} in ${fmt.monthLong(str(first, "month_end"))} to ${fmt.int(num(last, "claims_per_verified_loss"))} in ${fmt.monthLong(str(last, "month_end"))}: verified losses (${fmt.int(num(last, "verified_russian_uavs"))}) grew steadily while claims accelerated.`,
    `In the photo-verified record, three Russian types (${top3.map((r) => str(r, "platform")).join(", ")}) account for ${Math.round((top3.reduce((s, r) => s + num(r, "total"), 0) / total) * 100)}% of listed Russian UAV losses, and ${Math.round((russia.reduce((s, r) => s + num(r, "captured"), 0) / total) * 100)}% of those airframes were captured rather than destroyed.`,
    "Neither series is a complete count. Claims are unverified and one-sided; the verified record is a lower bound limited to identifiable airframes. Neither shows which drone types make up the claimed total.",
  ];
}

/* ----------------------------------------------------------------------------- claims vs verified */
function ComparisonView({ comparison }: { comparison: Row[] }) {
  const dark = useDarkMode();
  const months = useMemo(() => comparison.map((r) => str(r, "month_end")), [comparison]);
  const [period, setPeriod] = useState<[string, string]>([months[0], months.at(-1)!]);
  const [scale, setScale] = useState("Logarithmic");
  const filtered = useMemo(() => comparison.filter((r) => str(r, "month_end") >= period[0] && str(r, "month_end") <= period[1]), [comparison, period]);
  const start = filtered[0];
  const end = filtered.at(-1);

  const long = useMemo(() => filtered.flatMap((r) => [
    { month: r.month_end, series: CLAIMED, drones: r.claimed_russian_drones },
    { month: r.month_end, series: VERIFIED, drones: r.verified_russian_uavs },
  ]), [filtered]);
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 320, data: { values: long },
    mark: { type: "line", point: { size: 24 } },
    encoding: {
      x: { field: "month", type: "temporal", title: null },
      y: { field: "drones", type: "quantitative", scale: { type: scale === "Logarithmic" ? "log" : "linear" },
        title: `Cumulative Russian drones (${scale.toLowerCase()} scale)` },
      color: { field: "series", type: "nominal", scale: { domain: [CLAIMED, VERIFIED], range: [palette[1], palette[0]] },
        legend: { title: null, orient: "top", labelLimit: 400 } },
      tooltip: [{ field: "month", type: "temporal", title: "Month end", format: "%b %Y" }, { field: "series" }, { field: "drones", title: "Cumulative", format: "," }],
    },
  }), [long, scale, palette]);

  return (
    <View id="claimed-vs-verified" title="Claimed versus photo-verified: Russian drone losses" unit="Drones (uncrewed aerial vehicles), cumulative since 24 February 2022; ratio = claims per photo-verified loss.">
      <Provenance by="Ukraine's General Staff (claims) and Oryx (verification)" status="claimed" latest={months.at(-1)!} note="Oryx dropped its reconnaissance-UAV category in May 2026, so the comparison stops here" />
      <Controls>
        <RangeSelect label="Period" options={months} value={period} onChange={setPeriod} format={fmt.month} />
        <Segmented label="Vertical scale" options={["Logarithmic", "Linear"]} value={scale} onChange={setScale} />
      </Controls>
      {!start || !end ? <Empty>No months in this period. Widen the range.</Empty> : (
        <>
          <Metrics>
            <Metric label={`Claimed, to ${fmt.month(str(end, "month_end"))}`} value={fmt.int(num(end, "claimed_russian_drones"))} />
            <Metric label={`Photo-verified, to ${fmt.month(str(end, "month_end"))}`} value={fmt.int(num(end, "verified_russian_uavs"))} />
            <Metric label="Claims per verified loss" value={`${fmt.int(num(end, "claims_per_verified_loss"))}×`} note={`from ${fmt.dec(num(start, "claims_per_verified_loss"))}× in ${fmt.month(str(start, "month_end"))}`} />
            <Metric label="Added over the period" value={`${fmt.int(num(end, "claimed_russian_drones") - num(start, "claimed_russian_drones"))} claimed`} note={`${fmt.int(num(end, "verified_russian_uavs") - num(start, "verified_russian_uavs"))} verified`} />
          </Metrics>
          <VegaChart spec={spec} label="Cumulative claimed and photo-verified Russian drone losses" height={360} />
          <Table caption="Month-end claimed and verified totals" maxHeight={260} rows={[...filtered].reverse()} columns={[
            { key: "month_end", label: "Month end" },
            { key: "claimed_russian_drones", label: "Russian drones claimed", align: "right", format: (v) => fmt.int(v as number) },
            { key: "verified_russian_uavs", label: "Russian UAVs verified", align: "right", format: (v) => fmt.int(v as number) },
            { key: "verified_ukrainian_uavs", label: "Ukrainian UAVs verified", align: "right", format: (v) => fmt.int(v as number) },
            { key: "claims_per_verified_loss", label: "Claims per verified loss", align: "right", format: (v) => fmt.dec(v as number) },
          ]} />
        </>
      )}
      <Sources>
        <p>{CLAIMS_SOURCE}</p>
        <p>{ORYX_SOURCE}</p>
        <p>The two series do not measure the same thing, so the ratio is not an exaggeration factor. The General Staff figure is one belligerent&apos;s unverified claim with no platform breakdown. Oryx lists only losses with photo or video evidence, dated when documented, so it is a lower bound that lags events. The widening gap is consistent with growing use of drones that are rarely documented individually, but these data cannot show which types the claims consist of, or which number is closer to the truth.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={COMPARISON_COLS} fileName="drone_claims_vs_verified.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- claims by category */
function ClaimsView({ claims }: { claims: Row[] }) {
  const dark = useDarkMode();
  const months = useMemo(() => Array.from(new Set(claims.map((r) => str(r, "month_end")))).sort(), [claims]);
  const [chosen, setChosen] = useState(CATEGORIES);
  const [period, setPeriod] = useState<[string, string]>([months[0], months.at(-1)!]);
  const filtered = useMemo(() => claims.filter((r) => chosen.includes(str(r, "category"))
    && str(r, "month_end") >= period[0] && str(r, "month_end") <= period[1]), [claims, chosen, period]);
  const latest = filtered.map((r) => str(r, "month_end")).sort().at(-1);
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
  const shown = CATEGORIES.filter((c) => chosen.includes(c));

  const specs = useMemo(() => shown.map((category, i) => ({
    category,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 120,
      data: { values: filtered.filter((r) => r.category === category) },
      mark: { type: "bar", color: palette[CATEGORIES.indexOf(category) % palette.length] },
      encoding: {
        x: { field: "month_end", type: "temporal", title: null, scale: { domain: [period[0], period[1]] } },
        y: { field: "claimed_in_month", type: "quantitative", title: "Per month" },
        tooltip: [{ field: "month_end", type: "temporal", title: "Month", format: "%b %Y" }, { field: "category" },
          { field: "claimed_in_month", title: "Claimed in month", format: "," }, { field: "claimed_cumulative", title: "Cumulative", format: "," }],
      },
    } as TopLevelSpec,
    key: i,
  })), [filtered, shown, palette, period]);

  return (
    <View id="claims-by-category" title="How the claimed loss mix shifted to drones" unit="Items claimed destroyed per calendar month: the change in the cumulative total between month ends.">
      <Provenance by="General Staff of the Armed Forces of Ukraine" status="claimed" latest={months.at(-1)!} note="last complete month" />
      <Controls>
        <ChipSelect label="Categories" options={CATEGORIES} value={chosen} onChange={setChosen} />
        <RangeSelect label="Period" options={months} value={period} onChange={setPeriod} format={fmt.month} />
      </Controls>
      {filtered.length === 0 || !latest ? <Empty>No categories selected. Choose at least one category to see its monthly claims.</Empty> : (
        <>
          <Metrics>
            {shown.map((c) => {
              const nowRow = filtered.find((r) => r.category === c && r.month_end === latest);
              const prevRow = filtered.find((r) => r.category === c && r.month_end === yearEarlier(latest));
              const nowV = nowRow ? num(nowRow, "claimed_in_month") : NaN;
              const prevV = prevRow ? num(prevRow, "claimed_in_month") : NaN;
              return <Metric key={c} label={`${c}, ${fmt.month(latest)}`} value={fmt.int(nowV)}
                note={Number.isFinite(prevV) && prevV > 0 ? `${fmt.dec(nowV / prevV)}× a year earlier` : undefined} />;
            })}
          </Metrics>
          <p className="muted small">Each panel has its own vertical scale: compare shapes across panels, not heights.</p>
          {specs.map(({ category, spec }) => (
            <div key={category} className="small-multiple">
              <h3>{category}</h3>
              <VegaChart spec={spec} label={`Monthly claimed ${category.toLowerCase()}`} height={150} />
            </div>
          ))}
        </>
      )}
      <Sources>
        <p>{CLAIMS_SOURCE}</p>
        <p>These are claims by one party to the war and cannot be independently verified. Monthly values are differences of published cumulative totals, so later corrections to the running total fall into the month they were made.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={CLAIM_COLS} fileName="general_staff_claims.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- platforms */
function PlatformView({ platforms, comparison }: { platforms: Row[]; comparison: Row[] }) {
  const dark = useDarkMode();
  const origins = useMemo(() => Array.from(new Set(platforms.map((r) => str(r, "origin_country")))).sort(), [platforms]);
  const [side, setSide] = useState("Russia");
  const [chosen, setChosen] = useState(origins);
  const filtered = useMemo(() => platforms.filter((r) => r.side === side && chosen.includes(str(r, "origin_country")))
    .sort((a, b) => num(b, "total") - num(a, "total")), [platforms, side, chosen]);
  const total = filtered.reduce((s, r) => s + num(r, "total"), 0);
  const sideTotal = platforms.filter((r) => r.side === side).reduce((s, r) => s + num(r, "total"), 0);
  const oryxTotal = num(comparison.at(-1)!, side === "Russia" ? "verified_russian_uavs" : "verified_ukrainian_uavs");
  const top15 = filtered.slice(0, 15);
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;

  const long = useMemo(() => top15.flatMap((r) => STATUSES.map((s, i) => ({ platform: r.platform, origin: r.origin_country,
    total: r.total, status: s, rank: i, count: r[s] }))), [top15]);
  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: { step: 26 }, data: { values: long },
    mark: { type: "bar", height: 16, stroke: dark ? "#141a22" : "#ffffff", strokeWidth: 1 },
    encoding: {
      y: { field: "platform", type: "nominal", sort: top15.map((r) => str(r, "platform")), title: null, axis: { labelOverlap: false, labelLimit: 240 } },
      x: { field: "count", type: "quantitative", stack: "zero", title: "Documented losses" },
      color: { field: "status", type: "nominal", sort: STATUSES, scale: { domain: STATUSES, range: palette.slice(0, 4) }, legend: { title: "Status", orient: "top" } },
      order: { field: "rank", type: "quantitative" },
      tooltip: [{ field: "platform" }, { field: "origin", title: "Origin" }, { field: "status" }, { field: "count", title: "Count" }, { field: "total", title: "Platform total" }],
    },
  }), [long, top15, palette, dark]);

  return (
    <View id="platforms" title="Which drone platforms dominate the photo-verified record?" unit="Drones (individual airframes) with photo or video evidence of loss, cumulative to the snapshot date.">
      <Provenance by="Oryx (via Lee Drake's daily archive)" status="verified" latest={str(platforms[0], "snapshot_date")} note="last snapshot listing reconnaissance UAVs" />
      <Controls>
        <Segmented label="Side that lost the equipment" options={["Russia", "Ukraine"]} value={side} onChange={setSide} />
        <ChipSelect label="Country of origin" options={origins} value={chosen} onChange={setChosen} />
      </Controls>
      {filtered.length === 0 ? <Empty>No platforms match this side and these countries of origin. Add more countries of origin.</Empty> : (
        <>
          <Metrics>
            <Metric label={`${side}: documented UAV losses listed`} value={fmt.int(total)} note={`${filtered.length} platforms`} />
            <Metric label="Captured rather than destroyed" value={`${Math.round((filtered.reduce((s, r) => s + num(r, "captured"), 0) / total) * 100)}%`} />
            <Metric label="Most-documented platform" value={str(filtered[0], "platform")} note={`${Math.round((num(filtered[0], "total") / total) * 100)}% of selection`} />
            <Metric label="Coverage of Oryx's UAV total" value={`${Math.round((sideTotal / oryxTotal) * 100)}%`} note={`${fmt.int(sideTotal)} of ${fmt.int(oryxTotal)} (${side})`} />
          </Metrics>
          <h3>Top {top15.length} platforms by documented losses</h3>
          <VegaChart spec={spec} label="Top platforms by documented losses, stacked by status" />
          <Table caption="All matching platforms" maxHeight={300} rows={filtered} columns={[
            { key: "platform", label: "Platform" }, { key: "origin_country", label: "Origin" },
            { key: "oryx_category", label: "Oryx category" }, { key: "identification_basis", label: "Identified by" },
            ...STATUSES.map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), align: "right" as const })),
            { key: "total", label: "Total", align: "right" },
          ]} />
        </>
      )}
      <Sources>
        <p>{ORYX_SOURCE}</p>
        <p>Origin is the country Oryx flags as the producer (designs from before 1991 appear as &lsquo;Soviet Union&rsquo;). Platforms are matched to Oryx&apos;s UAV categories through the tracker&apos;s class list, plus named airframes it leaves unmapped (&lsquo;Platform name&rsquo;). Oryx excludes munitions, and no small quadcopter or FPV model appears in this snapshot, which is why it holds hundreds of airframes while claims run to hundreds of thousands.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={PLATFORM_COLS} fileName="verified_drone_platforms.csv" />
    </View>
  );
}
