import { csvParse } from "d3-dsv";

export type ServerRow = Record<string, string | number | null>;

export function parseCsvServer(text: string, numeric: string[]): ServerRow[] {
  const set = new Set(numeric);
  return csvParse(text, (raw) => {
    const row: ServerRow = {};
    for (const [k, v] of Object.entries(raw)) row[k] = v === undefined || v === "" ? null : set.has(k) ? Number(v) : v;
    return row;
  });
}
