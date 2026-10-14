import type { Metadata } from "next";
import Dashboard from "@/components/dashboards/Oil";

export const metadata: Metadata = {
  title: "Oil market",
  description: "Since 2000, which regions and countries have driven oil demand, which regions supply the gap, and how have Brent and WTI prices moved through the major shocks?",
};

export default function Page() {
  return (
    <article className="dashboard">
      <header className="dashboard-head">
        <p className="topic">Oil market</p>
        <h1>Where is oil demand still growing, who supplies it, and how have prices responded?</h1>
        <p className="plain">Oil powers transport and industry worldwide, and its price affects what we pay for petrol, flights and food. This page shows who uses oil, who produces it, and how its price has moved.</p>
        <p className="question-text"><strong>Question.</strong> Since 2000, which regions and countries have driven oil demand, which regions supply the gap, and how have Brent and WTI prices moved through the major shocks?</p>
        <p className="meta"><strong>For:</strong> Energy-policy analysts and students preparing briefings on oil market fundamentals. <strong>Coverage:</strong> Monthly Brent and WTI spot prices from January 1990; annual production and consumption for seven Energy Institute regions from 1965 and for 15 major economies plus the world from 2000.</p>
      </header>
      <Dashboard />
    </article>
  );
}
