import type { Metadata } from "next";
import Dashboard from "@/components/dashboards/Elections";

export const metadata: Metadata = {
  title: "2026 US elections",
  description: "How large have polling errors been in US general elections since 1998, and which of the 35 Senate contests on the 3 November 2026 ballot were last decided by margins smaller than a typical polling miss?",
};

export default function Page() {
  return (
    <article className="dashboard">
      <header className="dashboard-head">
        <p className="topic">2026 US elections</p>
        <h1>How far can the polls be off, and which Senate seats are inside that range?</h1>
        <p className="question-text"><strong>Question.</strong> How large have polling errors been in US general elections since 1998, and which of the 35 Senate contests on the 3 November 2026 ballot were last decided by margins smaller than a typical polling miss?</p>
        <p className="meta"><strong>For:</strong> Journalists, campaign volunteers and politically engaged readers interpreting 2026 Senate polls in the final weeks of the campaign. <strong>Coverage:</strong> 16,672 Democrat-vs-Republican general-election poll questions (1998–2022) and all 35 Senate seats on the 2026 ballot. No 2026 polls, forecasts or results are included.</p>
      </header>
      <Dashboard />
    </article>
  );
}
