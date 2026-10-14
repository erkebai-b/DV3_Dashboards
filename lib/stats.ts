export const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

export const median = (values: number[]) => quantile(values, 0.5);

/** Linear-interpolation quantile, matching numpy's default and pandas' Series.quantile. */
export function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

export const fmt = {
  int: (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("en-AU") : "–"),
  dec: (v: number, digits = 1) =>
    Number.isFinite(v) ? v.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "–",
  signed: (v: number, digits = 1) =>
    Number.isFinite(v)
      ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
      : "–",
  usd: (v: number) => (Number.isFinite(v) ? `US$${v.toFixed(2)}` : "–"),
  month: (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" }),
  monthLong: (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }),
};
