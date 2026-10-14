"use client";

import { useMemo, useState } from "react";
import type { TopLevelSpec } from "vega-lite";
import { type Row, num, str, useDatasets } from "@/lib/data";
import { fmt, groupBy, mean, median, quantile } from "@/lib/stats";
import { useDarkMode, VegaChart } from "@/components/VegaChart";
import { choropleth, classify, STATE_FIPS } from "@/lib/maps";
import {
  ChipSelect, Controls, DownloadCsv, Empty, Findings, Loading, Metric, Metrics, Provenance, RangeSelect, Segmented,
  SelectControl, Sources, Table, View,
} from "@/components/ui";

const RACES = ["Senate", "Governor", "House", "President"];
const OVER_D = "#2a78d6";
const OVER_R = "#e34948";
const POLL_COLS = ["question_id", "poll_id", "cycle", "race_type", "race", "location", "pollster", "methodology",
  "partisan_sponsor", "poll_date", "election_date", "days_to_election", "sample_size", "dem_margin_poll",
  "dem_margin_actual", "signed_error", "absolute_error", "called_wrong_winner"];
const SEAT_COLS = ["state", "state_name", "seat_class", "election_type", "incumbent", "incumbent_party", "incumbent_since",
  "last_election_cycle", "last_election_stage", "last_election_date", "last_winner_party", "last_dem_margin",
  "pres_2024_dem_margin", "last_margin_size", "senate_minus_pres_margin"];

const POLLS_SOURCE = <><cite>Pollster ratings database: raw_polls.csv</cite>, FiveThirtyEight (ABC News), <a href="https://github.com/fivethirtyeight/data/tree/master/pollster-ratings">archived on GitHub</a> (CC BY 4.0).</>;
const SEATS_SOURCE = <><cite>congress-legislators: legislators-current</cite>, The <a href="https://github.com/unitedstates/congress-legislators">@unitedstates project</a> (CC0); <cite>Election results: U.S. Senate and presidential</cite>, <a href="https://github.com/fivethirtyeight/election-results">FiveThirtyEight (ABC News)</a>.</>;

export default function ElectionsDashboard() {
  const state = useDatasets({
    polls: { path: "/data/elections/polls.csv", numeric: ["question_id", "poll_id", "cycle", "days_to_election", "sample_size",
      "dem_margin_poll", "dem_margin_actual", "signed_error", "absolute_error"] },
    seats: { path: "/data/elections/seats.csv", numeric: ["last_election_cycle", "last_dem_margin", "pres_2024_dem_margin",
      "last_margin_size", "senate_minus_pres_margin"] },
  });
  if (state.status !== "ready") return <Loading state={state} />;
  const { polls, seats } = state.data;
  return (
    <>
      <Findings items={findings(polls, seats)} />
      <ErrorView polls={polls} />
      <SeatsView polls={polls} seats={seats} />
    </>
  );
}

function findings(polls: Row[], seats: Row[]): string[] {
  const senate = polls.filter((r) => r.race_type === "Senate");
  const errors = senate.map((r) => num(r, "absolute_error"));
  const late = senate.filter((r) => num(r, "days_to_election") <= 7).map((r) => num(r, "absolute_error"));
  const p90 = quantile(errors, 0.9);
  const byCycle = Array.from(groupBy(senate, (r) => String(r.cycle))).map(([c, rows]) => ({ c, e: mean(rows.map((r) => num(r, "signed_error"))) }));
  const worst = byCycle.reduce((m, x) => (Math.abs(x.e) > Math.abs(m.e) ? x : m));
  const cycles = senate.map((r) => num(r, "cycle"));
  const inside = seats.filter((s) => s.last_dem_margin !== null && Math.abs(num(s, "last_dem_margin")) <= p90)
    .sort((a, b) => num(a, "last_margin_size") - num(b, "last_margin_size"));
  return [
    `Across ${fmt.int(senate.length)} Senate general-election polls from ${Math.min(...cycles)}–${Math.max(...cycles)}, the average absolute error on the margin was ${fmt.dec(mean(errors))} points; polls fielded in the final week were only modestly better (${fmt.dec(mean(late))} points).`,
    `One Senate poll in ten missed the final margin by more than ${fmt.dec(p90)} points.`,
    `Errors are correlated within a cycle: the largest average Senate miss was ${fmt.signed(worst.e)} points in ${worst.c} (${worst.e > 0 ? "overstating Democrats" : "overstating Republicans"}), and the direction has changed between cycles, so past bias is not a reliable correction for 2026.`,
    `${inside.length} of the ${seats.length} Senate contests on the 2026 ballot were last decided by less than that ${fmt.dec(p90)}-point band: ${inside.map((s) => str(s, "state_name")).join(", ")}.`,
  ];
}

/* ----------------------------------------------------------------------------- polling error */
type Unit = { race: string; cycle: number; race_type: string; signed: number; absolute: number; wrong: number };

function ErrorView({ polls }: { polls: Row[] }) {
  const dark = useDarkMode();
  const cycles = useMemo(() => Array.from(new Set(polls.map((r) => String(r.cycle)))).sort(), [polls]);
  const days = useMemo(() => Array.from(new Set(polls.map((r) => num(r, "days_to_election")))).sort((a, b) => a - b).map(String), [polls]);
  const [races, setRaces] = useState(RACES);
  const [span, setSpan] = useState<[string, string]>([cycles[0], cycles.at(-1)!]);
  const [daysWindow, setDaysWindow] = useState<[string, string]>([days[0], days.at(-1)!]);
  const [weighting, setWeighting] = useState("Each poll counts once");

  const filtered = useMemo(() => polls.filter((r) => races.includes(str(r, "race_type"))
    && num(r, "cycle") >= Number(span[0]) && num(r, "cycle") <= Number(span[1])
    && num(r, "days_to_election") >= Number(daysWindow[0]) && num(r, "days_to_election") <= Number(daysWindow[1])),
  [polls, races, span, daysWindow]);

  const units: Unit[] = useMemo(() => {
    if (weighting === "Each poll counts once") {
      return filtered.map((r) => ({ race: str(r, "race"), cycle: num(r, "cycle"), race_type: str(r, "race_type"),
        signed: num(r, "signed_error"), absolute: num(r, "absolute_error"), wrong: r.called_wrong_winner === "yes" ? 1 : 0 }));
    }
    return Array.from(groupBy(filtered, (r) => str(r, "race"))).map(([race, rows]) => ({
      race, cycle: num(rows[0], "cycle"), race_type: str(rows[0], "race_type"),
      signed: mean(rows.map((r) => num(r, "signed_error"))), absolute: mean(rows.map((r) => num(r, "absolute_error"))),
      wrong: mean(rows.map((r) => (r.called_wrong_winner === "yes" ? 1 : 0))),
    }));
  }, [filtered, weighting]);
  const noun = weighting === "Each poll counts once" ? "polls" : "races";

  const byCycleType = useMemo(() => Array.from(groupBy(units, (u) => `${u.cycle}|${u.race_type}`)).map(([k, rows]) => {
    const [cycle, race_type] = k.split("|");
    return { cycle: Number(cycle), race_type, absolute: mean(rows.map((u) => u.absolute)), n: rows.length };
  }), [units]);
  const byCycle = useMemo(() => Array.from(groupBy(units, (u) => String(u.cycle))).map(([cycle, rows]) => ({
    cycle: Number(cycle), signed: mean(rows.map((u) => u.signed)), n: rows.length })), [units]);

  const absSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 280, data: { values: byCycleType },
    mark: { type: "bar", cornerRadiusEnd: 3 },
    encoding: {
      x: { field: "cycle", type: "ordinal", title: null, axis: { labelAngle: 0 } },
      xOffset: { field: "race_type", sort: RACES },
      y: { field: "absolute", type: "quantitative", title: "Points" },
      color: { field: "race_type", type: "nominal", sort: RACES, legend: { title: null, orient: "top" },
        scale: { domain: RACES, range: dark ? ["#3987e5", "#d95926", "#199e70", "#9085e9"] : ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6"] } },
      tooltip: [{ field: "cycle", title: "Cycle" }, { field: "race_type", title: "Race type" },
        { field: "absolute", title: "Average absolute error", format: ".1f" }, { field: "n", title: noun }],
    },
  }), [byCycleType, dark, noun]);

  const signedSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 280, data: { values: byCycle },
    mark: { type: "bar", cornerRadiusEnd: 3 },
    encoding: {
      x: { field: "cycle", type: "ordinal", title: null, axis: { labelAngle: 0 } },
      y: { field: "signed", type: "quantitative", title: "Points" },
      color: { condition: { test: "datum.signed >= 0", value: OVER_D }, value: OVER_R },
      tooltip: [{ field: "cycle", title: "Cycle" }, { field: "signed", title: "Average signed error", format: "+.1f" }, { field: "n", title: noun }],
    },
  }), [byCycle, noun]);

  const summary = RACES.filter((r) => units.some((u) => u.race_type === r)).map((r) => {
    const rows = units.filter((u) => u.race_type === r);
    const abs = rows.map((u) => u.absolute);
    return { race: r, n: rows.length, mean: mean(abs), median: median(abs), p90: quantile(abs, 0.9),
      signed: mean(rows.map((u) => u.signed)), wrong: mean(rows.map((u) => u.wrong)) * 100 };
  });
  const bias = mean(units.map((u) => u.signed));

  return (
    <View id="polling-error" title="How wrong have pre-election polls been?" unit="Percentage points of the Democrat-minus-Republican margin. Error = poll margin − actual margin; positive values mean the poll overstated the Democrat.">
      <Provenance by="FiveThirtyEight (polls matched to certified results)" status="archived" latest={polls.map((r) => str(r, "election_date")).sort().at(-1)!} note="last election in the file; 2024 polls not included" />
      <Controls>
        <ChipSelect label="Race types" options={RACES} value={races} onChange={setRaces} />
        <RangeSelect label="Election cycles" options={cycles} value={span} onChange={setSpan} />
        <RangeSelect label="Days before election (median field date)" options={days} value={daysWindow} onChange={setDaysWindow} />
        <Segmented label="Averaging" options={["Each poll counts once", "Each race counts once"]} value={weighting} onChange={setWeighting} />
      </Controls>
      {filtered.length === 0 ? <Empty>No polls match these race types, cycles and timing. Widen the cycle range or add a race type.</Empty> : (
        <>
          <Metrics>
            <Metric label={`Average absolute error (${noun})`} value={`${fmt.dec(mean(units.map((u) => u.absolute)))} pts`} />
            <Metric label="Average signed error" value={`${fmt.signed(bias)} pts`} note={bias > 0 ? "toward Democrats" : "toward Republicans"} />
            <Metric label="90th-percentile absolute error" value={`${fmt.dec(quantile(units.map((u) => u.absolute), 0.9))} pts`} />
            <Metric label="Pointed to the wrong winner" value={`${Math.round(mean(units.map((u) => u.wrong)) * 100)}%`} />
            <Metric label="Polls in selection" value={fmt.int(filtered.length)} note={`${fmt.int(new Set(filtered.map((r) => r.race)).size)} races`} />
          </Metrics>
          <div className="pair">
            <div>
              <h3>Average absolute error by cycle</h3>
              <p className="muted small">How far polls were from the result, in either direction.</p>
              <VegaChart spec={absSpec} label="Average absolute polling error by cycle and race type" height={320} />
            </div>
            <div>
              <h3>Average signed error by cycle</h3>
              <p className="muted small">Above zero: polls overstated Democrats. Below zero: they overstated Republicans.</p>
              <VegaChart spec={signedSpec} label="Average signed polling error by cycle" height={320} />
            </div>
          </div>
          <Table caption="Polling error by race type" rows={summary} columns={[
            { key: "race", label: "Race type" },
            { key: "n", label: noun === "polls" ? "Polls" : "Races", align: "right", format: (v) => fmt.int(v as number) },
            { key: "mean", label: "Average abs. error", align: "right", format: (v) => fmt.dec(v as number) },
            { key: "median", label: "Median abs. error", align: "right", format: (v) => fmt.dec(v as number) },
            { key: "p90", label: "90th percentile", align: "right", format: (v) => fmt.dec(v as number) },
            { key: "signed", label: "Average signed error", align: "right", format: (v) => fmt.signed(v as number) },
            { key: "wrong", label: "Wrong winner", align: "right", format: (v) => `${fmt.dec(v as number)}%` },
          ]} />
        </>
      )}
      <Sources>
        <p>{POLLS_SOURCE}</p>
        <p>Only contests whose top two finishers were a Democrat and a Republican are included, so margins share a direction. Polls of the same race are not independent: a cycle-wide miss moves many polls together, which is why signed error swings between cycles.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={POLL_COLS} fileName="polling_errors.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- 2026 seats */
const BANDS: Record<string, number> = { "Median (50th percentile)": 0.5, "75th percentile": 0.75, "90th percentile": 0.9, "95th percentile": 0.95 };
const BASELINES: Record<string, string> = { "Last Senate result": "last_dem_margin", "2024 presidential result": "pres_2024_dem_margin" };

function SeatsView({ polls, seats }: { polls: Row[]; seats: Row[] }) {
  const dark = useDarkMode();
  const [parties, setParties] = useState(["Democrat", "Republican"]);
  const [band, setBand] = useState("90th percentile");
  const [baselineLabel, setBaseline] = useState("Last Senate result");
  const baseline = BASELINES[baselineLabel];
  const senateErrors = useMemo(() => polls.filter((r) => r.race_type === "Senate").map((r) => num(r, "absolute_error")), [polls]);
  const threshold = quantile(senateErrors, BANDS[band]);
  const filtered = useMemo(() => seats.filter((s) => parties.includes(str(s, "incumbent_party"))), [seats, parties]);

  const plot = filtered.map((s) => {
    const value = s[baseline] === null ? num(s, "pres_2024_dem_margin") : num(s, baseline);
    return {
      ...s, incumbent_party: str(s, "incumbent_party"), baseline: value, inside: Math.abs(value) <= threshold,
      label: `${str(s, "state_name")}${s.election_type === "Special" ? " (special)" : ""}`,
      exceeded: (senateErrors.filter((e) => e > Math.abs(value)).length / senateErrors.length) * 100,
      note: s[baseline] === null ? "No Democrat-vs-Republican contest; 2024 presidential margin used" : "",
    };
  });
  const inside = plot.filter((p) => p.inside);
  const order = [...plot].sort((a, b) => a.baseline - b.baseline).map((p) => p.label);

  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: { step: 22 },
    layer: [
      { data: { values: [{ lo: -threshold, hi: threshold }] }, mark: { type: "rect", color: dark ? "#3a4350" : "#dfe4e8", opacity: 0.7 },
        encoding: { x: { field: "lo", type: "quantitative" }, x2: { field: "hi" } } },
      { data: { values: [{ x: 0 }] }, mark: { type: "rule", color: dark ? "#8b95a2" : "#5a6472" }, encoding: { x: { field: "x", type: "quantitative" } } },
      {
        data: { values: plot },
        mark: { type: "circle", size: 110, opacity: 1, stroke: dark ? "#141a22" : "#ffffff", strokeWidth: 1.5 },
        encoding: {
          x: { field: "baseline", type: "quantitative", title: `${baselineLabel}: Democrat minus Republican (points)` },
          y: { field: "label", type: "nominal", sort: order, title: null },
          color: { field: "incumbent_party", type: "nominal", legend: { title: "Seat held by", orient: "top" },
            scale: { domain: ["Democrat", "Republican"], range: dark ? ["#3987e5", "#e66767"] : ["#2a78d6", "#e34948"] } },
          tooltip: [{ field: "label", title: "Seat" }, { field: "incumbent", title: "Incumbent" },
            { field: "baseline", title: "Margin (pts)", format: "+.1f" }, { field: "last_election_cycle", title: "Last Senate contest" },
            { field: "exceeded", title: "% of Senate polls with a bigger error", format: ".0f" }, { field: "note", title: "Note" }],
        },
      },
    ],
  }), [plot, order, threshold, baselineLabel, dark]);

  const table = [...plot].sort((a, b) => Math.abs(a.baseline) - Math.abs(b.baseline));

  const marginLabels = ["R by 20+", "R by 10–20", "R by 5–10", "R by 0–5", "D by 0–5", "D by 5–10", "D by 10–20", "D by 20+"];
  const mapRows = plot.map((p) => ({ marginClass: classify(p.baseline, [-20, -10, -5, 0, 5, 10, 20], marginLabels), id: STATE_FIPS[String((p as Record<string, unknown>).state)], baseline: p.baseline, inside: p.inside, label: p.label,
    incumbent: String((p as Record<string, unknown>).incumbent), party: p.incumbent_party, exceeded: p.exceeded }));
  const mapSpec = useMemo(() => choropleth({
    url: "/geo/us-states-10m.json", feature: "states", projection: "albersUsa", rows: mapRows, height: 420, dark,
    fields: ["baseline", "label", "incumbent", "party", "exceeded", "inside", "marginClass"], strokeField: "inside",
    color: { field: "marginClass", type: "nominal", title: "Baseline margin, points",
      scale: { domain: marginLabels, range: ["#9e1b1b", "#d43d3d", "#ec8a87", "#f6c9c6", "#c6dbf5", "#7fb0ec", "#2a78d6", "#154a8f"] },
      legend: { orient: "bottom", direction: "horizontal", columns: 4, symbolType: "square" } },
    tooltip: [{ field: "label", title: "Seat" }, { field: "incumbent", title: "Incumbent" }, { field: "party", title: "Party" },
      { field: "baseline", title: "Margin (pts)", format: "+.1f" },
      { field: "exceeded", title: "% of Senate polls with a bigger error", format: ".0f" }],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(mapRows), dark]);

  return (
    <View id="senate-2026" title="Which 2026 Senate seats sit inside the historical polling error?" unit="Percentage points of the Democrat-minus-Republican margin (negative = Republican lead). Shaded band: ± the chosen percentile of absolute error in Senate polls, 1998–2022.">
      <Provenance by="@unitedstates roster; FiveThirtyEight results" status="observed" latest={seats.map((s) => str(s, "last_election_date")).sort().at(-1)!} note="seats and incumbents as listed 15 Oct 2026; election day 3 Nov 2026" />
      <Controls>
        <ChipSelect label="Party holding the seat" options={["Democrat", "Republican"]} value={parties} onChange={setParties} />
        <SelectControl label="Historical Senate polling error band" options={Object.keys(BANDS)} value={band} onChange={setBand} />
        <Segmented label="Baseline margin" options={Object.keys(BASELINES)} value={baselineLabel} onChange={setBaseline} />
      </Controls>
      {filtered.length === 0 ? <Empty>No party selected. Choose Democrat, Republican or both to see their seats.</Empty> : (
        <>
          <Metrics>
            <Metric label="Error band" value={`± ${fmt.dec(threshold)} pts`} note={band} />
            <Metric label="Seats inside the band" value={`${inside.length} of ${plot.length}`} />
            <Metric label="Held by Democrats" value={String(inside.filter((p) => p.incumbent_party === "Democrat").length)} />
            <Metric label="Held by Republicans" value={String(inside.filter((p) => p.incumbent_party === "Republican").length)} />
          </Metrics>
          <h3>Where the 2026 Senate contests are</h3>
          <p className="muted small">Colour: the chosen baseline margin (blue = Democratic lead, red = Republican lead). Dark outline: inside the ± {fmt.dec(threshold)}-point band. Grey: no Senate contest in 2026.</p>
          <VegaChart spec={mapSpec} label="US map of 2026 Senate contests coloured by baseline margin" height={480} />
          <h3>Every seat against the error band</h3>
          <VegaChart spec={spec} label="2026 Senate seats by baseline margin against the polling error band" />
          <h3>Seats ranked by closeness</h3>
          <Table caption="2026 Senate seats ranked by closeness of the chosen baseline" maxHeight={360} rows={table} columns={[
            { key: "label", label: "Seat" },
            { key: "incumbent", label: "Incumbent (15 Oct 2026)" },
            { key: "incumbent_party", label: "Party" },
            { key: "last_election_cycle", label: "Last contest", align: "right" },
            { key: "last_dem_margin", label: "Last Senate margin", align: "right", format: (v) => (v === null ? "–" : fmt.signed(v as number)) },
            { key: "pres_2024_dem_margin", label: "2024 presidential margin", align: "right", format: (v) => fmt.signed(v as number) },
            { key: "exceeded", label: "Senate polls with a bigger error", align: "right", format: (v) => `${Math.round(v as number)}%` },
          ]} />
        </>
      )}
      <Sources>
        <p>{SEATS_SOURCE} Error band from {POLLS_SOURCE}</p>
        <p>A past margin is not a 2026 forecast: candidates, turnout and the national environment change, several seats have new appointees, and whether an incumbent is running is not recorded here. Arkansas 2020 had no Democratic nominee, so its baseline falls back to the 2024 presidential margin. Louisiana&apos;s last contest was an all-party primary.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={SEAT_COLS} fileName="senate_2026_seats.csv" />
    </View>
  );
}
