"use client";

import { useMemo, useState } from "react";
import type { TopLevelSpec } from "vega-lite";
import { type Row, num, str, useDatasets } from "@/lib/data";
import { fmt, groupBy, mean, median, quantile } from "@/lib/stats";
import { useDarkMode, VegaChart } from "@/components/VegaChart";
import { choropleth, classify, STATE_FIPS } from "@/lib/maps";
import Link from "next/link";
import {
  ChipSelect, Controls, DownloadCsv, Empty, type Finding, Findings, PointsTo, Loading, Metric, Metrics, Provenance, RangeSelect, Segmented,
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
    swing: { path: "/data/elections/swing.csv", numeric: ["dem_margin_2020", "dem_margin_2024", "swing_2020_2024"] },
    polls2026: { path: "/data/elections/polls_2026.csv", numeric: ["pct_1", "pct_2", "lead_1", "dem_lead"] },
    generic2026: { path: "/data/elections/generic_2026.csv", numeric: ["dem_pct", "rep_pct", "dem_lead"] },
  });
  if (state.status !== "ready") return <Loading state={state} />;
  const { polls, seats, swing, polls2026, generic2026 } = state.data;
  return (
    <>
      <Findings items={findings(polls, seats, swing, polls2026)} gaps={GAPS} />
      <ControlPanel polls={polls} seats={seats} polls2026={polls2026} generic={generic2026} />
      <ErrorView polls={polls} />
      <Polls2026View polls={polls} polls2026={polls2026} generic={generic2026} />
      <SwingView swing={swing} />
      <SeatsView polls={polls} seats={seats} polls2026={polls2026} />
      <WorldContext />
    </>
  );
}

const GAPS = [
  "No polling error for 2024: FiveThirtyEight's open poll archive ends with the 2022 cycle (538 closed in 2025). 2026 polls are added by hand from cited reports, one row per poll, so coverage depends on what has been entered.",
  "No campaign finance, advertising or race ratings yet. FEC data need an API key, and rating outlets restrict reuse.",
  "Results for 3 November 2026 do not exist yet; nothing here is a forecast.",
];

function latestPerState(rows: Row[]): Row[] {
  const best = new Map<string, Row>();
  for (const r of rows) {
    const current = best.get(str(r, "state"));
    if (!current || str(r, "poll_date") > str(current, "poll_date")) best.set(str(r, "state"), r);
  }
  return Array.from(best.values());
}

function findings(polls: Row[], seats: Row[], swing: Row[], polls2026: Row[]): Finding[] {
  const senate = polls.filter((r) => r.race_type === "Senate");
  const errors = senate.map((r) => num(r, "absolute_error"));
  const late = senate.filter((r) => num(r, "days_to_election") <= 7).map((r) => num(r, "absolute_error"));
  const p90 = quantile(errors, 0.9);
  const byCycle = Array.from(groupBy(senate, (r) => String(r.cycle))).map(([c, rows]) => ({ c, e: mean(rows.map((r) => num(r, "signed_error"))) }));
  const worst = byCycle.reduce((m, x) => (Math.abs(x.e) > Math.abs(m.e) ? x : m));
  const cycles = senate.map((r) => num(r, "cycle"));
  const inside = seats.filter((s) => s.last_dem_margin !== null && Math.abs(num(s, "last_dem_margin")) <= p90)
    .sort((a, b) => num(a, "last_margin_size") - num(b, "last_margin_size"));
  const swings = swing.map((r) => num(r, "swing_2020_2024"));
  const towardR = swing.filter((r) => num(r, "swing_2020_2024") < 0).length;
  const biggest = [...swing].sort((a, b) => num(a, "swing_2020_2024") - num(b, "swing_2020_2024"))[0];
  const latest26 = latestPerState(polls2026);
  const meanErr = mean(errors);
  const insideP90 = latest26.filter((r) => Math.abs(num(r, "lead_1")) <= p90).length;
  const insideMean = latest26.filter((r) => Math.abs(num(r, "lead_1")) <= meanErr).length;
  return [
    ...(latest26.length ? [{ text: `Of the ${latest26.length} Senate races with a 2026 poll entered, ${insideP90} show a lead smaller than a 1-in-10 historical miss (${fmt.dec(p90)} points), and ${insideMean} a lead smaller than an average miss (${fmt.dec(meanErr)} points).`,
      stars: 3 as const, basis: "Single polls, hand-entered from cited reports; the error bands are well measured, the polls are snapshots." }] : []),
    { text: `${towardR === swing.length ? "Every one" : `${towardR}`} of the ${swing.length} states and DC moved toward the Republican presidential candidate between 2020 and 2024 (median swing ${fmt.dec(Math.abs(median(swings)))} points; largest ${str(biggest, "state_name")}, ${fmt.dec(Math.abs(num(biggest, "swing_2020_2024")))} points).`,
      stars: 5, basis: "Certified statewide results. A presidential swing is context for 2026, not a midterm forecast." },
    { text: `Across ${fmt.int(senate.length)} Senate general-election polls from ${Math.min(...cycles)}–${Math.max(...cycles)}, the average absolute error on the margin was ${fmt.dec(mean(errors))} points; polls fielded in the final week were only modestly better (${fmt.dec(mean(late))} points).`,
      stars: 4, basis: "Large sample matched to certified results; archive ends in 2022 and polls of the same race share errors." },
    { text: `One Senate poll in ten missed the final margin by more than ${fmt.dec(p90)} points.`,
      stars: 4, basis: "Same archive; the tail is what matters for close races." },
    { text: `The largest average Senate miss was ${fmt.signed(worst.e)} points in ${worst.c} (${worst.e > 0 ? "overstating Democrats" : "overstating Republicans"}), and the direction has changed between cycles.`,
      stars: 4, basis: "Accurate history, but only a weak (★★) guide to which way 2026 polls will lean." },
    { text: `${inside.length} of the ${seats.length} Senate contests on the 2026 ballot were last decided by less than that ${fmt.dec(p90)}-point band: ${inside.map((s) => str(s, "state_name")).join(", ")}.`,
      stars: 2, basis: "Past margins with different candidates: a baseline for attention, not a forecast of competitiveness." },
  ];
}

/* ----------------------------------------------------------------------------- control scenarios */
// Chamber totals before the election (cited on the page). Independents who caucus with Democrats count as Democrats.
const SENATE_NOW = { R: 53, D: 47, source: "Forbes race tracker, 13 Oct 2026" };
const HOUSE_NOW = { R: 218, D: 214, I: 1, vacant: 2, source: "House Press Gallery, page updated 2 Sep 2026" };
const SENATE_MAJORITY_D = 51; // a 50-50 Senate is controlled by the Republican vice-president's tie-break

type Scenario = { D: number; R: number };

/** Senate seats after 3 Nov 2026 under a rule for the polled races; unpolled seats stay with the party holding them. */
function senateScenario(seats: Row[], polls2026: Row[], rule: (demLead: number) => "D" | "R" | "keep"): Scenario {
  const latest = new Map(latestPerState(polls2026).map((r) => [str(r, "state"), r]));
  let D = SENATE_NOW.D;
  for (const seat of seats) {
    const poll = latest.get(str(seat, "state"));
    if (!poll || poll.dem_lead === null) continue;
    const outcome = rule(num(poll, "dem_lead"));
    if (outcome === "keep") continue;
    const held = seat.incumbent_party === "Democrat" ? "D" : "R";
    if (held === "R" && outcome === "D") D += 1;
    if (held === "D" && outcome === "R") D -= 1;
  }
  return { D, R: SENATE_NOW.D + SENATE_NOW.R - D };
}

const controlOf = (sc: Scenario) => (sc.D >= SENATE_MAJORITY_D ? "Democrats" : "Republicans");
const PartyName = ({ name }: { name: string }) => <span className={name === "Democrats" ? "party-d" : "party-r"}>{name}</span>;

function ControlPanel({ polls, seats, polls2026, generic }: { polls: Row[]; seats: Row[]; polls2026: Row[]; generic: Row[] }) {
  const dark = useDarkMode();
  const senateErr = polls.filter((r) => r.race_type === "Senate").map((r) => num(r, "absolute_error"));
  const avg = mean(senateErr);
  const p90 = quantile(senateErr, 0.9);
  const leaders = senateScenario(seats, polls2026, (l) => (l > 0 ? "D" : l < 0 ? "R" : "keep"));
  const lead = (band: number, close: "D" | "R") => senateScenario(seats, polls2026, (l) => (Math.abs(l) <= band ? close : l > 0 ? "D" : "R"));
  const avgR = lead(avg, "R"), avgD = lead(avg, "D"), p90R = lead(p90, "R"), p90D = lead(p90, "D");
  const latestGeneric = [...generic].sort((a, b) => str(a, "date").localeCompare(str(b, "date"))).at(-1);
  const polled = latestPerState(polls2026).filter((r) => r.dem_lead !== null).length;

  const ranges = useMemo(() => [
    { label: "If the close races all go one way", lo: avgR.D, hi: avgD.D, order: 1 },
    { label: "If polls are off by as much as they sometimes are", lo: p90R.D, hi: p90D.D, order: 2 },
  ], [avgR.D, avgD.D, p90R.D, p90D.D]);
  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: { step: 46 },
    layer: [
      { data: { values: [{ x: 45 - 0.5, x2: 50.5 }] }, mark: { type: "rect", color: dark ? "#3a2224" : "#f8e3e2" }, encoding: { x: { field: "x", type: "quantitative" }, x2: { field: "x2" } } },
      { data: { values: [{ x: 50.5, x2: 56 }] }, mark: { type: "rect", color: dark ? "#1d2c40" : "#e1ecfa" }, encoding: { x: { field: "x", type: "quantitative" }, x2: { field: "x2" } } },
      { data: { values: ranges },
        mark: { type: "bar", height: 14, cornerRadius: 7, color: dark ? "#98a2ae" : "#5a6472" },
        encoding: {
          y: { field: "label", type: "nominal", sort: { field: "order" }, title: null, axis: { labelLimit: 340 } },
          x: { field: "lo", type: "quantitative", title: "Democratic Senate seats after the election", scale: { domain: [44.5, 56], zero: false, nice: false }, axis: { tickMinStep: 1, format: "d", values: [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56] } },
          x2: { field: "hi" },
          tooltip: [{ field: "label", title: "Scenario" }, { field: "lo", title: "Fewest Democratic seats" }, { field: "hi", title: "Most Democratic seats" }],
        } },
      { data: { values: [{ x: 50.5 }] }, mark: { type: "rule", strokeWidth: 2, color: dark ? "#e8ebef" : "#18212d", strokeDash: [4, 3] }, encoding: { x: { field: "x", type: "quantitative" } } },
      { data: { values: ranges.map((r) => ({ ...r, x: leaders.D })) }, mark: { type: "point", shape: "diamond", size: 170, filled: true, color: dark ? "#3987e5" : "#2a78d6" },
        encoding: { x: { field: "x", type: "quantitative" }, y: { field: "label", type: "nominal", sort: { field: "order" } }, tooltip: [{ field: "x", title: "If every poll leader wins" }] } },
    ],
  }), [ranges, leaders.D, dark]);

  return (
    <section className="view" id="control" aria-labelledby="control-title">
      <h2 id="control-title">Who is on track to control Congress?</h2>
      <p className="plain">If today&apos;s polls are right, Democrats would narrowly win the Senate. But many races are so close that a normal polling miss could keep it Republican.</p>
      <p className="how-to"><span className="how-to-label">How to read it</span>The grey bars show the range of Democratic seats, from &quot;every close race goes Republican&quot; to &quot;every close race goes Democratic&quot;. The diamond is what happens if every poll leader wins. Democrats need to reach the dashed line (51 seats) to take control.</p>
      <p className="unit">Senate seats after 3 November 2026 under simple, stated scenarios. Not a forecast: one poll per race, and every seat without a poll is assumed to stay with the party that holds it.</p>
      <Metrics>
        <Metric label="Senate now" value={`R ${SENATE_NOW.R} – D ${SENATE_NOW.D}`} note={`Democrats need ${SENATE_MAJORITY_D - SENATE_NOW.D} net gains (a 50–50 tie goes to Republicans)`} />
        <Metric label="If every poll leader wins" value={`D ${leaders.D} – R ${leaders.R}`} note={`${controlOf(leaders)} control`} />
        <Metric label="If close races all go one way" value={`D ${avgR.D} to ${avgD.D}`} note={`races within ${fmt.dec(avg)} points`} />
        <Metric label="If polls miss by as much as they sometimes do" value={`D ${p90R.D} to ${p90D.D}`} note={`races within ${fmt.dec(p90)} points`} />
      </Metrics>
      <p className="muted small">Grey bars: range of Democratic seats if the close races all go one way or the other. Diamond: every current poll leader wins. Dashed line: majority line (51 for Democrats; at 50 or fewer, Republicans control with the vice-president&apos;s tie-break).</p>
      <VegaChart spec={spec} label="Range of Democratic Senate seats under polling-error scenarios" height={150} />
      <PointsTo stars={2} basis={`Single polls in ${polled} of 35 races, hand-entered from cited reports; the error bands come from 4,850 historical polls.`}>
        <p><strong>Senate:</strong> if every candidate leading in today&apos;s polls wins, <PartyName name={controlOf(leaders)} /> control the Senate, {leaders.D} seats to {leaders.R}. But if the close races all go Republican, it ends {avgR.D}–{avgR.R} and <PartyName name={controlOf(avgR)} /> stay in charge. If they all go Democratic, Democrats get {avgD.D}. Bottom line: Democrats have a slight edge on current polls, but the Senate is still up for grabs.</p>
        {latestGeneric && <p><strong>House:</strong> Republicans hold {HOUSE_NOW.R} of 435 seats (Democrats {HOUSE_NOW.D}, {HOUSE_NOW.I} independent, {HOUSE_NOW.vacant} vacant). The latest generic-ballot reading in the workbook has <PartyName name={num(latestGeneric, "dem_lead") >= 0 ? "Democrats" : "Republicans"} /> ahead by {fmt.dec(Math.abs(num(latestGeneric, "dem_lead")))} points nationally ({str(latestGeneric, "measure")}, {str(latestGeneric, "date")}). In plain words, more voters say they plan to vote Democratic for the House, which points to Democrats gaining seats. The exact result also depends on how district lines are drawn, and several states redrew theirs for 2026.</p>}
      </PointsTo>
      <Sources>
        <p>Chamber totals: {SENATE_NOW.source}; {HOUSE_NOW.source}. Polls: the curated 2026 workbook. Error bands: {POLLS_SOURCE}</p>
      </Sources>
    </section>
  );
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
    <View id="polling-error" plain={<>Polls are useful but not exact. A typical Senate poll ends up about 5 points away from the real result, and one in ten is off by more than 11 points.</>} howTo={<>Taller bars mean polls were further off that year. In the second chart, bars above zero mean polls flattered Democrats; below zero, they flattered Republicans.</>} title="How wrong have pre-election polls been?" unit="Percentage points of the Democrat-minus-Republican margin. Error = poll margin − actual margin; positive values mean the poll overstated the Democrat.">
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
      <PointsTo stars={4} basis="4,850 Senate polls matched to certified results, 1998–2022.">
        <p>This chart does not favour either party. It tells you how much to trust a poll: if a candidate leads by less than about {fmt.dec(mean(polls.filter((r) => r.race_type === "Senate").map((r) => num(r, "absolute_error"))), 0)} points, the race is still a toss-up. Polls have been wrong in favour of Republicans in some years and Democrats in others, so nobody can know in advance which way 2026 polls will lean.</p>
      </PointsTo>
      <Sources>
        <p>{POLLS_SOURCE}</p>
        <p>Only contests whose top two finishers were a Democrat and a Republican are included, so margins share a direction. Polls of the same race are not independent: a cycle-wide miss moves many polls together, which is why signed error swings between cycles.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={POLL_COLS} fileName="polling_errors.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- 2026 polls */
const POLLS26_COLS = ["state", "race", "seat_status", "candidate_1", "party_1", "pct_1", "candidate_2", "party_2", "pct_2",
  "pollster", "poll_date", "sample_note", "source_url", "lead_1", "dem_lead"];

function Polls2026View({ polls, polls2026, generic }: { polls: Row[]; polls2026: Row[]; generic: Row[] }) {
  const dark = useDarkMode();
  const [scope, setScope] = useState("Latest poll per race");
  const senate = useMemo(() => polls.filter((r) => r.race_type === "Senate").map((r) => num(r, "absolute_error")), [polls]);
  const avg = mean(senate);
  const p90 = quantile(senate, 0.9);
  const shown = useMemo(() => (scope === "Latest poll per race" ? latestPerState(polls2026) : polls2026), [polls2026, scope]);
  const plotted = shown.filter((r) => r.dem_lead !== null).map((r) => ({ ...r,
    label: `${str(r, "race")}${scope === "All polls" ? ` · ${str(r, "pollster")}` : ""}`,
    leader: num(r, "dem_lead") > 0 ? "Democrat" : num(r, "dem_lead") < 0 ? "Republican" : "Tie",
    leadText: num(r, "dem_lead") === 0 ? "Tie" : `${num(r, "dem_lead") > 0 ? "D" : "R"}+${Math.abs(num(r, "dem_lead"))}` }));
  const order = [...plotted].sort((a, b) => num(a, "dem_lead") - num(b, "dem_lead")).map((r) => r.label);
  const unplotted = shown.filter((r) => r.dem_lead === null);
  const band = (abs: number) => (abs <= avg ? "avg" : abs <= p90 ? "p90" : "out");
  const counts = { avg: 0, p90: 0, out: 0 };
  for (const r of shown) counts[band(Math.abs(num(r, "lead_1")))] += 1;
  const latestDate = polls2026.map((r) => str(r, "poll_date")).sort().at(-1) ?? "–";

  const spec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: { step: 30 },
    layer: [
      { data: { values: [{ lo: -p90, hi: p90 }] }, mark: { type: "rect", color: dark ? "#2a323d" : "#e7ebee" }, encoding: { x: { field: "lo", type: "quantitative" }, x2: { field: "hi" } } },
      { data: { values: [{ lo: -avg, hi: avg }] }, mark: { type: "rect", color: dark ? "#3a4450" : "#d3dae0" }, encoding: { x: { field: "lo", type: "quantitative" }, x2: { field: "hi" } } },
      { data: { values: [{ x: 0 }] }, mark: { type: "rule", color: dark ? "#8b95a2" : "#5a6472" }, encoding: { x: { field: "x", type: "quantitative" } } },
      { data: { values: plotted },
        layer: [
          { mark: { type: "circle", size: 140, opacity: 1, stroke: dark ? "#141a22" : "#ffffff", strokeWidth: 1.5 },
            encoding: {
              x: { field: "dem_lead", type: "quantitative", title: "Poll lead: Democrat minus Republican (points)", scale: { domain: [-Math.max(20, p90 + 4), Math.max(20, p90 + 4)] } },
              y: { field: "label", type: "nominal", sort: order, title: null, axis: { labelLimit: 260 } },
              color: { field: "leader", type: "nominal", legend: { title: "Poll leader", orient: "top" },
                scale: { domain: ["Democrat", "Republican", "Tie"], range: dark ? ["#3987e5", "#e66767", "#98a2ae"] : ["#2a78d6", "#e34948", "#7b8591"] } },
              tooltip: [{ field: "race", title: "Race" }, { field: "candidate_1", title: "Candidate 1" }, { field: "pct_1", title: "%" },
                { field: "candidate_2", title: "Candidate 2" }, { field: "pct_2", title: "%" }, { field: "pollster" }, { field: "poll_date", title: "Date" }],
            } },
          { transform: [{ filter: "datum.dem_lead >= 0" }],
            mark: { type: "text", dx: 14, align: "left", fontSize: 11, color: dark ? "#c3c9d1" : "#3a4452" },
            encoding: { x: { field: "dem_lead", type: "quantitative" }, y: { field: "label", type: "nominal", sort: order }, text: { field: "leadText" } } },
          { transform: [{ filter: "datum.dem_lead < 0" }],
            mark: { type: "text", dx: -14, align: "right", fontSize: 11, color: dark ? "#c3c9d1" : "#3a4452" },
            encoding: { x: { field: "dem_lead", type: "quantitative" }, y: { field: "label", type: "nominal", sort: order }, text: { field: "leadText" } } },
        ] },
    ],
  }), [plotted, order, avg, p90, dark]);

  const genericSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 160, data: { values: generic },
    mark: { type: "line", point: { size: 60 } },
    encoding: {
      x: { field: "date", type: "temporal", title: null, axis: { format: "%d %b" } },
      y: { field: "dem_lead", type: "quantitative", title: "Democratic lead (pts)", scale: { zero: true } },
      color: { field: "measure", type: "nominal", legend: { title: null, orient: "top", labelLimit: 320 },
        scale: { range: dark ? ["#3987e5", "#d95926"] : ["#2a78d6", "#eb6834"] } },
      tooltip: [{ field: "measure" }, { field: "date", type: "temporal", format: "%d %b %Y" }, { field: "dem_pct", title: "Democrats %" },
        { field: "rep_pct", title: "Republicans %" }, { field: "dem_lead", title: "Lead", format: "+.1f" }],
    },
  }), [generic, dark]);

  return (
    <View id="polls-2026" plain={<>These are the latest polls for this year&apos;s key Senate races. Most leads are small enough that a normal polling miss could flip the result.</>} howTo={<>Each dot is one race. Dots to the right of the middle line mean the Democrat leads; to the left, the Republican leads. If a dot sits inside the grey bands, the lead is smaller than polls usually miss by.</>} title="2026 Senate polls against the historical error" unit="Percentage points of the Democrat-minus-Republican margin in a single poll. Dark band: ± the average Senate poll miss; light band: ± the miss exceeded by one poll in ten (1998–2022).">
      <Provenance by="Pollsters named in each row; entered by hand from cited reports" status="curated" latest={latestDate} note="latest poll date entered" />
      <Controls>
        <Segmented label="Polls shown" options={["Latest poll per race", "All polls"]} value={scope} onChange={setScope} />
      </Controls>
      {shown.length === 0 ? <Empty>No 2026 polls have been entered yet. Add rows to the curated workbook to see them here.</Empty> : (
        <>
          <Metrics>
            <Metric label="Races with a 2026 poll entered" value={`${latestPerState(polls2026).length} of 35`} />
            <Metric label={`Lead within an average miss (± ${fmt.dec(avg)})`} value={String(counts.avg)} />
            <Metric label={`Within a 1-in-10 miss (± ${fmt.dec(p90)})`} value={String(counts.p90)} note="but larger than an average miss" />
            <Metric label="Larger than a 1-in-10 miss" value={String(counts.out)} />
          </Metrics>
          <VegaChart spec={spec} label="2026 Senate poll leads plotted against historical polling error bands" />
          {unplotted.length > 0 && (
            <p className="muted small">Not plotted (parties not stated in the source, so the lead cannot be signed Democrat-minus-Republican): {unplotted.map((r) => `${str(r, "race")} (${str(r, "candidate_1")} ${num(r, "pct_1")}, ${str(r, "candidate_2")} ${num(r, "pct_2")})`).join("; ")}.</p>
          )}
          <h3>Every poll entered</h3>
          <Table caption="2026 Senate polls with sources" maxHeight={340} rows={[...shown].sort((a, b) => Math.abs(num(a, "lead_1")) - Math.abs(num(b, "lead_1")))} columns={[
            { key: "race", label: "Race" },
            { key: "candidate_1", label: "Result", format: (_v, r) => `${r.candidate_1}${r.party_1 ? ` (${r.party_1})` : ""} ${r.pct_1} – ${r.candidate_2}${r.party_2 ? ` (${r.party_2})` : ""} ${r.pct_2}` },
            { key: "lead_1", label: "Lead", align: "right", format: (v) => (v === 0 ? "Tie" : `${Math.abs(v as number)}`) },
            { key: "pollster", label: "Pollster" }, { key: "poll_date", label: "Date" },
            { key: "sample_note", label: "Note" },
            { key: "source_url", label: "Source", format: (v) => <a href={String(v)} target="_blank" rel="noreferrer">Report</a> },
          ]} />
          {generic.length > 0 && (
            <>
              <h3>Generic congressional ballot</h3>
              <p className="muted small">Which party voters say they will back for the House. A national mood gauge, not a seat count.</p>
              <VegaChart spec={genericSpec} label="Generic congressional ballot, Democratic lead over time" height={200} />
            </>
          )}
        </>
      )}
      {shown.length > 0 && (() => {
        const latest = latestPerState(polls2026).filter((r) => r.dem_lead !== null);
        const dLead = latest.filter((r) => num(r, "dem_lead") > 0);
        const rLead = latest.filter((r) => num(r, "dem_lead") < 0);
        const close = latest.filter((r) => Math.abs(num(r, "dem_lead")) <= avg);
        return (
          <PointsTo stars={2} basis="One poll per race, hand-entered; a snapshot weeks before election day.">
            <p><span className="party-d">Democrats lead in {dLead.length} races</span>: {dLead.map((r) => str(r, "race")).join(", ") || "none"}. <span className="party-r">Republicans lead in {rLead.length}</span>: {rLead.map((r) => str(r, "race")).join(", ") || "none"}.{latest.length - dLead.length - rLead.length > 0 ? ` ${latest.length - dLead.length - rLead.length} race is tied.` : ""}</p>
            <p>{dLead.length > rLead.length ? "So on paper Democrats are ahead" : dLead.length < rLead.length ? "So on paper Republicans are ahead" : "On paper it is even"}, but {close.length} of these {latest.length} races are too close to call: {close.map((r) => str(r, "race")).join(", ")}. {(() => { const clear = latest.filter((r) => Math.abs(num(r, "dem_lead")) > p90); return clear.length ? `Only ${clear.map((r) => `${str(r, "race")} (${num(r, "dem_lead") > 0 ? "Democrat" : "Republican"} ahead)`).join(", ")} has a lead big enough to survive even a large polling miss.` : "No lead is big enough to survive a large polling miss."; })()}</p>
          </PointsTo>
        );
      })()}
      <Sources>
        <p><cite>2026 Senate polls and generic ballot (curated workbook)</cite>, compiled for this site with a source link on every row; error bands from {POLLS_SOURCE}</p>
        <p>Each dot is one poll, not an average. Polls in the same cycle often miss in the same direction, so several races inside the band can move together. The workbook lives in the repository; anyone can see what was entered and when.</p>
      </Sources>
      <DownloadCsv rows={shown} columns={POLLS26_COLS} fileName="senate_polls_2026.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- 2020 -> 2024 swing */
const SWING_COLS = ["state", "state_name", "dem_margin_2020", "dem_margin_2024", "senate_race_2026", "swing_2020_2024", "election_date"];

function SwingView({ swing }: { swing: Row[] }) {
  const dark = useDarkMode();
  const [scope, setScope] = useState("All states");
  const filtered = useMemo(() => swing.filter((r) => scope === "All states" || r.senate_race_2026 === "yes"), [swing, scope]);
  const swingLabels = ["R by 8+", "R by 6–8", "R by 4–6", "R by 2–4", "R by 0–2", "Toward D"];
  const mapRows = filtered.map((r) => ({ id: STATE_FIPS[str(r, "state")], swingClass: classify(num(r, "swing_2020_2024"), [-8, -6, -4, -2, 0], swingLabels),
    name: str(r, "state_name"), swing: num(r, "swing_2020_2024"), m20: num(r, "dem_margin_2020"), m24: num(r, "dem_margin_2024"),
    senate: r.senate_race_2026 === "yes" })).filter((r) => r.id);
  const mapSpec = useMemo(() => choropleth({
    url: "/geo/us-states-10m.json", feature: "states", projection: "albersUsa", rows: mapRows, height: 400, dark,
    fields: ["swingClass", "name", "swing", "m20", "m24", "senate"], strokeField: "senate",
    color: { field: "swingClass", type: "nominal", title: "Swing in presidential margin, 2020 → 2024 (points)",
      scale: { domain: swingLabels, range: ["#7a1414", "#b42626", "#d65050", "#ec8a87", "#f6c9c6", "#7fb0ec"] },
      legend: { orient: "bottom", direction: "horizontal", columns: 6, symbolType: "square" } },
    tooltip: [{ field: "name", title: "State" }, { field: "m20", title: "2020 margin (D − R)", format: "+.1f" },
      { field: "m24", title: "2024 margin (D − R)", format: "+.1f" }, { field: "swing", title: "Swing (pts)", format: "+.1f" }],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(mapRows), dark]);
  const sorted = [...filtered].sort((a, b) => num(a, "swing_2020_2024") - num(b, "swing_2020_2024"));
  const barSpec = useMemo<TopLevelSpec>(() => ({
    $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: { step: 14 }, data: { values: sorted },
    mark: { type: "bar", cornerRadiusEnd: 2, height: 10 },
    encoding: {
      y: { field: "state_name", type: "nominal", sort: sorted.map((r) => str(r, "state_name")), title: null, axis: { labelFontSize: 10, labelOverlap: false } },
      x: { field: "swing_2020_2024", type: "quantitative", title: "Change in Democrat-minus-Republican margin (points)" },
      color: { condition: { test: "datum.senate_race_2026 === 'yes'", value: dark ? "#e66767" : "#c43a3a" }, value: dark ? "#6b7480" : "#b5bcc4" },
      tooltip: [{ field: "state_name", title: "State" }, { field: "swing_2020_2024", title: "Swing (pts)", format: "+.1f" },
        { field: "senate_race_2026", title: "2026 Senate race" }],
    },
  }), [sorted, dark]);
  const swings = filtered.map((r) => num(r, "swing_2020_2024"));
  const senateSwings = swing.filter((r) => r.senate_race_2026 === "yes").map((r) => num(r, "swing_2020_2024"));

  return (
    <View id="swing" plain={<>Between 2020 and 2024, every single state voted more Republican for president than before.</>} howTo={<>Darker red means a state moved further toward Republicans. States with a thick outline also hold a Senate race in 2026.</>} title="How the country moved between 2020 and 2024" unit="Percentage points. Swing = 2024 presidential margin minus 2020 margin (Democrat minus Republican); negative = moved toward the Republican.">
      <Provenance by="State election offices, compiled by FiveThirtyEight" status="observed" latest="2024-11-05" note="certified presidential results" />
      <Controls>
        <Segmented label="States" options={["All states", "Only states with a 2026 Senate race"]} value={scope} onChange={setScope} />
      </Controls>
      <Metrics>
        <Metric label="States that moved toward Republicans" value={`${filtered.filter((r) => num(r, "swing_2020_2024") < 0).length} of ${filtered.length}`} />
        <Metric label="Median swing" value={`${fmt.signed(median(swings))} pts`} />
        <Metric label="Largest swing" value={str(sorted[0], "state_name")} note={`${fmt.signed(num(sorted[0], "swing_2020_2024"))} pts`} />
        <Metric label="Median swing, 2026 Senate states" value={`${fmt.signed(median(senateSwings))} pts`} />
      </Metrics>
      <p className="muted small">Map colour: swing size. Dark outline: state with a 2026 Senate contest.</p>
      <VegaChart spec={mapSpec} label="US map of the presidential swing from 2020 to 2024" height={460} />
      <h3>Every state, ranked by swing</h3>
      <p className="muted small">Red bars: states with a 2026 Senate contest.</p>
      <VegaChart spec={barSpec} label="States ranked by presidential swing from 2020 to 2024" />
      <PointsTo stars={3} basis="Certified results; how a presidential swing carries into a midterm is uncertain.">
        <p>In 2024 the whole country moved toward <span className="party-r">Republicans</span>, by about {fmt.dec(Math.abs(median(swings)), 0)} points in a typical state. That gives Republicans a head start. But in midterm elections voters often turn against the president&apos;s party, so 2024 tells you where 2026 starts, not where it ends. Look at the 2026 polls above as well.</p>
      </PointsTo>
      <Sources>
        <p>{SEATS_SOURCE}</p>
        <p>Margins use the top Democratic and Republican candidates&apos; shares of the statewide vote. Maine and Nebraska award some electoral votes by district; the statewide vote is used here. Midterm electorates differ from presidential ones, and the president&apos;s party has often lost ground in midterms, so this swing is context, not a forecast.</p>
      </Sources>
      <DownloadCsv rows={filtered} columns={SWING_COLS} fileName="presidential_swing_2020_2024.csv" />
    </View>
  );
}

/* ----------------------------------------------------------------------------- why it matters */
function WorldContext() {
  return (
    <section className="context" aria-labelledby="context-title">
      <h2 id="context-title">Why a US midterm matters beyond the US</h2>
      <p>The 3 November 2026 election decides who controls Congress for the next two years, and Congress holds powers that reach well beyond American borders:</p>
      <ul>
        <li><strong>Money.</strong> No federal money can be spent without an appropriation passed by Congress (US Constitution, Article I, Section 9). That includes military and economic aid abroad: US support for Ukraine has been funded through congressional appropriations, which links this page to the <Link href="/drones">drone losses dashboard</Link>.</li>
        <li><strong>Sanctions and trade.</strong> Congress regulates commerce with foreign nations (Article I, Section 8) and can write sanctions into law, as it did for Russia in 2017. Sanctions on oil exporters feed directly into the prices on the <Link href="/oil">oil market dashboard</Link>.</li>
        <li><strong>Treaties and appointments.</strong> The Senate must approve treaties by a two-thirds vote and confirms ambassadors and senior officials (Article II, Section 2), so Senate control shapes foreign policy staffing and commitments.</li>
      </ul>
      <p>That is why this dashboard asks how far polls can be off: readers worldwide will see headlines about which party is ahead in the Senate. Knowing that one Senate poll in ten has missed by more than about 11 points, and which seats sit inside that range, helps them judge how much those headlines can actually tell them.</p>
      <p className="muted small">This section describes constitutional powers and documented legislation; it makes no prediction about the outcome or about any policy that might follow.</p>
    </section>
  );
}

/* ----------------------------------------------------------------------------- 2026 seats */
const BANDS: Record<string, number> = { "Median (50th percentile)": 0.5, "75th percentile": 0.75, "90th percentile": 0.9, "95th percentile": 0.95 };
const BASELINES: Record<string, string> = { "Last Senate result": "last_dem_margin", "2024 presidential result": "pres_2024_dem_margin",
  "Latest 2026 poll": "poll_2026_dem_lead" };

function SeatsView({ polls, seats: baseSeats, polls2026 }: { polls: Row[]; seats: Row[]; polls2026: Row[] }) {
  const seats = useMemo(() => {
    const latest = new Map(latestPerState(polls2026).map((r) => [str(r, "state"), r]));
    return baseSeats.map((s): Row => ({ ...s, poll_2026_dem_lead: latest.get(str(s, "state"))?.dem_lead ?? null }));
  }, [baseSeats, polls2026]);
  const dark = useDarkMode();
  const [parties, setParties] = useState(["Democrat", "Republican"]);
  const [band, setBand] = useState("90th percentile");
  const [baselineLabel, setBaseline] = useState("Last Senate result");
  const baseline = BASELINES[baselineLabel];
  const senateErrors = useMemo(() => polls.filter((r) => r.race_type === "Senate").map((r) => num(r, "absolute_error")), [polls]);
  const threshold = quantile(senateErrors, BANDS[band]);
  const filtered = useMemo(() => seats.filter((s) => parties.includes(str(s, "incumbent_party"))), [seats, parties]);
  const usingPolls = baseline === "poll_2026_dem_lead";

  const plot = filtered.filter((s) => !usingPolls || s.poll_2026_dem_lead !== null).map((s) => {
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
  const mapRows = plot.map((p) => ({ marginClass: p.baseline === 0 ? "Tie" : classify(p.baseline, [-20, -10, -5, 0, 5, 10, 20], marginLabels), id: STATE_FIPS[String((p as Record<string, unknown>).state)], baseline: p.baseline, inside: p.inside, label: p.label,
    incumbent: String((p as Record<string, unknown>).incumbent), party: p.incumbent_party, exceeded: p.exceeded }));
  const mapSpec = useMemo(() => choropleth({
    url: "/geo/us-states-10m.json", feature: "states", projection: "albersUsa", rows: mapRows, height: 420, dark,
    fields: ["baseline", "label", "incumbent", "party", "exceeded", "inside", "marginClass"], strokeField: "inside",
    color: { field: "marginClass", type: "nominal", title: "Baseline margin, points",
      scale: { domain: [...marginLabels, "Tie"], range: ["#9e1b1b", "#d43d3d", "#ec8a87", "#f6c9c6", "#c6dbf5", "#7fb0ec", "#2a78d6", "#154a8f", "#8a939d"] },
      legend: { orient: "bottom", direction: "horizontal", columns: 4, symbolType: "square" } },
    tooltip: [{ field: "label", title: "Seat" }, { field: "incumbent", title: "Incumbent" }, { field: "party", title: "Party" },
      { field: "baseline", title: "Margin (pts)", format: "+.1f" },
      { field: "exceeded", title: "% of Senate polls with a bigger error", format: ".0f" }],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(mapRows), dark]);

  return (
    <View id="senate-2026" plain={<>These are the 35 Senate seats people will vote on in November 2026, and how close each one was last time.</>} howTo={<>Pale colours mean the seat was close; dark colours mean it was a landslide. A thick outline means the seat is close enough that a normal polling miss could decide it.</>} title="Which 2026 Senate seats sit inside the historical polling error?" unit="Percentage points of the Democrat-minus-Republican margin (negative = Republican lead). Shaded band: ± the chosen percentile of absolute error in Senate polls, 1998–2022.">
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
          {usingPolls && <p className="muted small">Showing the {plot.length} seats with a signed 2026 poll entered; the other {filtered.length - plot.length} seats have no poll in the curated workbook (or no stated parties) and are left grey, not estimated.</p>}
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
      {plot.length > 0 && (() => {
        const rHeld = seats.filter((x) => x.incumbent_party === "Republican").length;
        const dHeld = seats.filter((x) => x.incumbent_party === "Democrat").length;
        const rInside = inside.filter((p) => p.incumbent_party === "Republican").length;
        const dInside = inside.filter((p) => p.incumbent_party === "Democrat").length;
        return (
          <PointsTo stars={2} basis={usingPolls ? "Single 2026 polls; seats without a poll are not shown." : "Past results with different candidates; a guide to where to look, not who will win."}>
            <p>Of the 35 seats being voted on, <span className="party-r">{rHeld} belong to Republicans</span> and <span className="party-d">{dHeld} to Democrats</span>. Republicans have more seats to defend; Democrats need to win 4 more than they lose. Using the {baselineLabel.toLowerCase()}, {rInside} Republican seats and {dInside} Democratic seats are close enough to change hands. {rInside > dInside ? "Most of the close seats are Republican, so that is where Democrats would have to win." : rInside < dInside ? "Most of the close seats are Democratic, which helps Republicans keep control." : "The close seats are split evenly."}</p>
          </PointsTo>
        );
      })()}
      <Sources>
        <p>{SEATS_SOURCE} Error band from {POLLS_SOURCE}</p>
        <p>A past margin is not a 2026 forecast: candidates, turnout and the national environment change, several seats have new appointees, and whether an incumbent is running is not recorded here. Arkansas 2020 had no Democratic nominee, so its baseline falls back to the 2024 presidential margin. Louisiana&apos;s last contest was an all-party primary.</p>
      </Sources>
      <DownloadCsv rows={filtered.map((s) => Object.fromEntries(SEAT_COLS.map((c) => [c, (s as Record<string, unknown>)[c] as string | number | null])))} columns={SEAT_COLS} fileName="senate_2026_seats.csv" />
    </View>
  );
}
