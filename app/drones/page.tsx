import type { Metadata } from "next";
import Dashboard from "@/components/dashboards/Drones";

export const metadata: Metadata = {
  title: "Drone losses",
  description: "How fast have drone losses grown, how far apart are official claims and photo-verified evidence, and which platforms and countries of origin dominate the verified record?",
};

export default function Page() {
  return (
    <article className="dashboard">
      <header className="dashboard-head">
        <p className="topic">Drone losses</p>
        <h1>Drone losses in the Russia–Ukraine war: what is claimed, what is verified, and which platforms?</h1>
        <p className="plain">Drones have become the main weapon in the Russia–Ukraine war. This page compares what Ukraine&apos;s army says it has destroyed with what can be proven by photos.</p>
        <p className="question-text"><strong>Question.</strong> How fast have drone losses grown, how far apart are official claims and photo-verified evidence, and which platforms and countries of origin dominate the verified record?</p>
        <p className="meta"><strong>For:</strong> Journalists, analysts and students who cite drone-loss figures and need to know what each number does and does not measure. <strong>Coverage:</strong> Monthly claims from February 2022 to the last complete month; photo-verified UAV losses for both sides from March 2022 to April 2026; platform detail at 3 May 2026.</p>
      </header>
      <Dashboard />
    </article>
  );
}
