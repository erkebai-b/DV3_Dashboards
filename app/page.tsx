import Link from "next/link";
import { readCsv } from "@/lib/server";

function oilAnswer() {
  const rows = readCsv("oil/countries.csv", ["year", "consumption_index_2019", "oil_share_energy_pct"]).filter((r) => r.country === "World");
  const latest = rows.reduce((m, r) => ((r.year as number) > (m.year as number) ? r : m));
  const base = rows.find((r) => r.year === 2019)!;
  return `World oil use in ${latest.year} was ${((latest.consumption_index_2019 as number) - 100).toFixed(1)}% above 2019, even as oil's share of energy fell from ${(base.oil_share_energy_pct as number).toFixed(1)}% to ${(latest.oil_share_energy_pct as number).toFixed(1)}%.`;
}

function electionAnswer() {
  const polls = readCsv("elections/polls.csv", ["absolute_error"]).filter((r) => r.race_type === "Senate").map((r) => r.absolute_error as number).sort((a, b) => a - b);
  const pos = (polls.length - 1) * 0.9;
  const p90 = polls[Math.floor(pos)] + (polls[Math.ceil(pos)] - polls[Math.floor(pos)]) * (pos - Math.floor(pos));
  const seats = readCsv("elections/seats.csv", ["last_dem_margin"]);
  const inside = seats.filter((s) => s.last_dem_margin !== null && Math.abs(s.last_dem_margin as number) <= p90).length;
  return `One Senate poll in ten has missed by more than ${p90.toFixed(1)} points, and ${inside} of the ${seats.length} seats on the 2026 ballot were last decided by less than that.`;
}

function droneAnswer() {
  const rows = readCsv("drones/comparison.csv", ["claimed_russian_drones", "verified_russian_uavs", "claims_per_verified_loss"]);
  const last = rows.at(-1)!;
  return `By ${new Date(`${last.month_end}T00:00:00Z`).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" })}, Ukraine's General Staff had claimed ${(last.claimed_russian_drones as number).toLocaleString("en-AU")} Russian drones; Oryx had photo evidence for ${(last.verified_russian_uavs as number).toLocaleString("en-AU")}.`;
}

export default function Home() {
  const questions = [
    { href: "/oil", topic: "Oil market", q: "Where is oil demand still growing, who supplies it, and how have prices responded?", a: oilAnswer(),
      by: "U.S. Energy Information Administration; Energy Institute" },
    { href: "/elections", topic: "2026 US elections", q: "How far can the polls be off, and which 2026 Senate seats are inside that range?", a: electionAnswer(),
      by: "FiveThirtyEight; the @unitedstates project" },
    { href: "/drones", topic: "Drone losses", q: "What is claimed, what is verified, and which drone platforms dominate the record?", a: droneAnswer(),
      by: "General Staff of the Armed Forces of Ukraine; Oryx" },
  ];
  return (
    <>
      <section className="hero">
        <h1>Three questions, and exactly what the data can say about them.</h1>
        <p className="lede">Each dashboard answers one question for a specific reader, keeps claims apart from verified evidence, and shows who counted every number.</p>
      </section>
      <ol className="questions" aria-label="Dashboards">
        {questions.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="question">
              <span className="topic">{item.topic}</span>
              <span className="q">{item.q}</span>
              <span className="a">{item.a}</span>
              <span className="by">Counted by {item.by}</span>
              <span className="open">Open the {item.topic.toLowerCase()} dashboard</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
