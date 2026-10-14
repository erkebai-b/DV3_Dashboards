"use client";

import { csvFormat } from "d3-dsv";
import type { ReactNode } from "react";
import type { Row } from "@/lib/data";

export type Status = "observed" | "estimated" | "claimed" | "verified" | "archived" | "derived" | "curated";

const STATUS_TEXT: Record<Status, string> = {
  observed: "Observed values",
  estimated: "Statistical estimates, revised each edition",
  claimed: "Unverified claim by a party to the war",
  verified: "Photo- or video-verified, lower bound",
  archived: "Archived; no longer updated",
  derived: "Derived in this pipeline",
  curated: "Curated by hand; every row cites its source",
};

/** Who counted it, how certain it is, and when it was last observed. */
export function Provenance({ by, status, latest, note }: { by: string; status: Status; latest: string; note?: string }) {
  return (
    <dl className="provenance">
      <div>
        <dt>Counted by</dt>
        <dd>{by}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <span className={`status status-${status}`}>{STATUS_TEXT[status]}</span>
        </dd>
      </div>
      <div>
        <dt>Latest observation</dt>
        <dd>
          <time dateTime={latest}>{latest}</time>
          {note ? <span className="muted"> · {note}</span> : null}
        </dd>
      </div>
    </dl>
  );
}

export function View({ id, title, unit, plain, howTo, children }: {
  id: string; title: string; unit: string; plain?: ReactNode; howTo?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="view" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {plain && <p className="plain">{plain}</p>}
      {howTo && <p className="how-to"><span className="how-to-label">How to read it</span>{howTo}</p>}
      <p className="unit">Units: {unit}</p>
      {children}
    </section>
  );
}

export function Controls({ children }: { children: ReactNode }) {
  return <div className="controls">{children}</div>;
}

export function ChipSelect({ label, options, value, onChange, max }: {
  label: string; options: string[]; value: string[]; onChange: (next: string[]) => void; max?: number;
}) {
  const full = max !== undefined && value.length >= max;
  const toggle = (option: string) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : options.filter((o) => value.includes(o) || o === option));
  return (
    <fieldset className="control">
      <legend>{label}</legend>
      <div className="chips">
        {options.map((option) => (
          <button key={option} type="button" className="chip" aria-pressed={value.includes(option)}
            disabled={full && !value.includes(option)} onClick={() => toggle(option)}>
            {option}
          </button>
        ))}
      </div>
      <div className="chip-actions">
        {max === undefined || options.length <= max
          ? <button type="button" className="link-button" onClick={() => onChange(options)}>Select all</button>
          : <span className="muted small">Up to {max} at a time, so every line keeps its own colour</span>}
        <button type="button" className="link-button" onClick={() => onChange([])}>Clear</button>
      </div>
    </fieldset>
  );
}

export function Segmented({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (next: string) => void;
}) {
  return (
    <fieldset className="control">
      <legend>{label}</legend>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={value === option} onClick={() => onChange(option)}>
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Inclusive range picker built from two native selects (accessible on every device). */
export function RangeSelect({ label, options, value, onChange, format = (v) => v }: {
  label: string; options: string[]; value: [string, string]; onChange: (next: [string, string]) => void;
  format?: (value: string) => string;
}) {
  return (
    <fieldset className="control">
      <legend>{label}</legend>
      <div className="range">
        <label>
          <span>From</span>
          <select value={value[0]} onChange={(e) => onChange([e.target.value, value[1] < e.target.value ? e.target.value : value[1]])}>
            {options.map((o) => <option key={o} value={o}>{format(o)}</option>)}
          </select>
        </label>
        <label>
          <span>To</span>
          <select value={value[1]} onChange={(e) => onChange([value[0] > e.target.value ? e.target.value : value[0], e.target.value])}>
            {options.map((o) => <option key={o} value={o}>{format(o)}</option>)}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function SelectControl({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (next: string) => void;
}) {
  return (
    <label className="control">
      <span className="legend">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function Metrics({ children }: { children: ReactNode }) {
  return <dl className="metrics">{children}</dl>;
}

export function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <span className="metric-value">{value}</span>
        {note ? <span className="metric-note">{note}</span> : null}
      </dd>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty" role="status">{children}</p>;
}

export function Sources({ children }: { children: ReactNode }) {
  return (
    <details className="sources">
      <summary>Sources and details</summary>
      {children}
    </details>
  );
}

export function DownloadCsv({ rows, columns, fileName }: { rows: Row[]; columns: string[]; fileName: string }) {
  const download = () => {
    const blob = new Blob([csvFormat(rows, columns)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="download" onClick={download}>
      Download filtered data (CSV, {rows.length.toLocaleString("en-AU")} rows)
    </button>
  );
}

export function Table({ columns, rows, caption, maxHeight = 320 }: {
  columns: { key: string; label: string; align?: "right"; format?: (v: unknown, row: Record<string, unknown>) => ReactNode }[];
  rows: Record<string, unknown>[]; caption: string; maxHeight?: number;
}) {
  return (
    <div className="table-wrap" style={{ maxHeight }} tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                  {c.format ? c.format(row[c.key], row) : row[c.key] === null || row[c.key] === undefined ? "–" : String(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Loading({ state }: { state: { status: "loading" } | { status: "error"; message: string } }) {
  return state.status === "loading" ? (
    <p className="loading" role="status">Loading data…</p>
  ) : (
    <p className="empty" role="alert">The data files could not be loaded ({state.message}). Reload the page; if it persists, the latest deployment is missing its data.</p>
  );
}

export type Finding = { text: string; stars: 1 | 2 | 3 | 4 | 5; basis: string };

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" role="img" aria-label={`Evidence rating ${n} of 5`}>
      {"★".repeat(n)}<span className="stars-off">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export function Findings({ items, gaps }: { items: Finding[]; gaps: string[] }) {
  return (
    <section className="findings" aria-labelledby="findings-title">
      <h2 id="findings-title">What the data show</h2>
      <ul>
        {items.map((item) => (
          <li key={item.text}>
            {item.text}
            <span className="evidence"><Stars n={item.stars} /> {item.basis}</span>
          </li>
        ))}
      </ul>
      <h3 className="gaps-title">What these data cannot show yet</h3>
      <ul className="gaps">{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
      <p className="muted small">Computed in your browser from the published data files, so these sentences update when the data do. Evidence ratings: <a href="/method#evidence">how they are scored</a>.</p>
    </section>
  );
}

/** "What this points to": the plain-language reading of a view for 2026, with its evidence rating. */
export function PointsTo({ children, stars, basis }: { children: ReactNode; stars: 1 | 2 | 3 | 4 | 5; basis: string }) {
  return (
    <aside className="points-to" aria-label="What this points to for 2026">
      <h3>What this points to for 2026</h3>
      <div>{children}</div>
      <p className="evidence"><Stars n={stars} /> {basis}</p>
    </aside>
  );
}
