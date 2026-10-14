"use client";

import { useEffect, useRef, useState } from "react";
import type { TopLevelSpec } from "vega-lite";

export function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return dark;
}

function themeConfig(dark: boolean) {
  const ink = dark ? "#c9ced6" : "#4a5361";
  const grid = dark ? "#2c3440" : "#e4e8eb";
  return {
    background: "transparent",
    font: "Public Sans Variable, system-ui, sans-serif",
    view: { stroke: null },
    axis: {
      labelColor: ink, titleColor: ink, gridColor: grid, domainColor: grid, tickColor: grid,
      labelFontSize: 12, titleFontSize: 12, titleFontWeight: 500, labelFont: "Public Sans Variable, system-ui, sans-serif",
    },
    legend: { labelColor: ink, titleColor: ink, labelFontSize: 12, titleFontSize: 12, symbolType: "circle" },
    header: { labelColor: ink, titleColor: ink, labelFontSize: 12 },
    title: { color: ink },
    line: { strokeWidth: 2 },
  };
}

/** Render a Vega-Lite spec. The chart re-renders when the spec (including its inline data) changes. */
export function VegaChart({ spec, label, height }: { spec: TopLevelSpec; label: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = useDarkMode();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let finalize: (() => void) | undefined;
    let cancelled = false;
    import("vega-embed").then(({ default: embed }) => {
      if (cancelled || !ref.current) return;
      const full = { ...spec, config: { ...themeConfig(dark), ...(spec as { config?: object }).config } } as TopLevelSpec;
      embed(ref.current, full, { actions: false, renderer: "svg", tooltip: { theme: dark ? "dark" : "light" } })
        .then((result) => {
          finalize = () => result.finalize();
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    });
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [spec, dark]);

  return (
    <figure className="chart" aria-label={label} style={{ minHeight: height }}>
      <div ref={ref} className="chart-canvas" />
      {error && <p className="chart-error">Chart could not be drawn: {error}</p>}
    </figure>
  );
}
