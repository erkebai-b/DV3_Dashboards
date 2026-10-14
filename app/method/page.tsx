import type { Metadata } from "next";

export const metadata: Metadata = { title: "Method", description: "How the data are acquired, validated, refreshed and published." };

export default function Method() {
  return (
    <article className="prose">
      <h1>Method</h1>
      <p className="lede">Every number on this site comes from a public source, passes a written data contract, and is labelled with who counted it.</p>

      <h2>How data reach the page</h2>
      <ol>
        <li><strong>Acquire.</strong> A scheduled GitHub Actions job downloads each raw source: EIA spot prices (via DataHub), the Energy Institute Statistical Review (via Our World in Data), FiveThirtyEight&apos;s poll and results archives, the @unitedstates legislator roster, Ukraine&apos;s General Staff claims (via Petro Ivaniuk&apos;s dataset) and Oryx&apos;s verified losses (via Lee Drake&apos;s archive).</li>
        <li><strong>Transform.</strong> Each dashboard has its own Python pipeline that shapes the raw files into tidy record-level tables and computes derived measures: net balances, consumption indices, poll errors, month-end claim totals.</li>
        <li><strong>Validate.</strong> Every table is checked against a manifest that declares its columns, types, keys, allowed values, units and plausible ranges, plus cross-checks: regional oil totals must reproduce the world total, poll errors must reproduce the margins, and comparison claims must match the claims series. Any failure stops the job, so the site keeps its last good data.</li>
        <li><strong>Publish.</strong> Validated tables are committed as CSV files; Vercel redeploys automatically. Filtering, charts, headline findings and CSV downloads all run in your browser from those files.</li>
      </ol>

      <h2>Status labels</h2>
      <dl className="definitions">
        <dt><span className="status status-observed">Observed values</span></dt><dd>Measured market prices, published as recorded.</dd>
        <dt><span className="status status-estimated">Statistical estimates</span></dt><dd>Compiled national statistics that are revised in later editions.</dd>
        <dt><span className="status status-archived">Archived</span></dt><dd>A source that is no longer updated; coverage ends where the archive ends.</dd>
        <dt><span className="status status-claimed">Unverified claim</span></dt><dd>A statement by a party to a conflict. Shown as a claim, never merged with verified counts.</dd>
        <dt><span className="status status-verified">Verified, lower bound</span></dt><dd>Each item has photo or video evidence; the true total is higher.</dd>
      </dl>

      <h2>What this site does not do</h2>
      <ul>
        <li>No forecasts. The 2026 election view compares past margins with past polling error; it does not predict results.</li>
        <li>No causal claims from correlation. Price moves, demand shifts and loss trends are described, not attributed.</li>
        <li>No merged war-loss totals. Claimed and verified figures stay in separate series because they count different things.</li>
      </ul>

      <h2>Licences</h2>
      <p>Code is released under the MIT licence. Data remain under their publishers&apos; terms: EIA (public domain, via DataHub ODC-PDDL), Our World in Data (CC BY 4.0), FiveThirtyEight (CC BY 4.0), @unitedstates (CC0), and the MIT-licensed Ivaniuk and Drake repositories. The Energy Institute and Oryx are credited as original sources.</p>
    </article>
  );
}
