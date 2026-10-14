import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/public-sans";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { readMeta } from "@/lib/server";

export const metadata: Metadata = {
  title: { default: "DV3 Dashboards: oil, polls and drones", template: "%s | DV3 Dashboards" },
  description: "Three evidence dashboards on the oil market, 2026 US Senate polling error, and drone losses in the Russia–Ukraine war, with every number traced to who measured it.",
};

const REPO = "https://github.com/erkebai-b/DV3_Dashboards";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = readMeta();
  const refreshed = new Date(meta.refreshed_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <html lang="en-AU">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="site-header">
          <div className="wrap header-inner">
            <Link href="/" className="brand">DV3 Dashboards</Link>
            <nav aria-label="Dashboards">
              <Link href="/oil">Oil market</Link>
              <Link href="/elections">2026 elections</Link>
              <Link href="/drones">Drone losses</Link>
              <Link href="/method">Method</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="wrap">{children}</main>
        <footer className="site-footer">
          <div className="wrap footer-inner">
            <p>Data last refreshed {refreshed} by an automated, validated pipeline. Each view names its sources and their licences.</p>
            <p><a href={REPO}>Source code and pipeline on GitHub</a></p>
          </div>
        </footer>
      </body>
    </html>
  );
}
