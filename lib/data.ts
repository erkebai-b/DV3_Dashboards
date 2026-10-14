"use client";

import { csvParse } from "d3-dsv";
import { useEffect, useState } from "react";

export type Row = Record<string, string | number | null>;

/** Parse CSV text, converting only the named columns to numbers. Empty fields become null; other text is kept verbatim. */
export function parseCsv(text: string, numeric: string[]): Row[] {
  const numericSet = new Set(numeric);
  return csvParse(text, (raw) => {
    const row: Row = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined || value === "") row[key] = null;
      else if (numericSet.has(key)) row[key] = Number(value);
      else row[key] = value;
    }
    return row;
  });
}

export type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Fetch several CSV files in parallel and parse them with their numeric column lists. */
export function useDatasets<K extends string>(specs: Record<K, { path: string; numeric: string[] }>): LoadState<Record<K, Row[]>> {
  const [state, setState] = useState<LoadState<Record<K, Row[]>>>({ status: "loading" });
  const key = JSON.stringify(specs);
  useEffect(() => {
    let cancelled = false;
    const entries = Object.entries(specs) as [K, { path: string; numeric: string[] }][];
    Promise.all(
      entries.map(async ([name, spec]) => {
        const response = await fetch(spec.path);
        if (!response.ok) throw new Error(`${spec.path} returned ${response.status}`);
        return [name, parseCsv(await response.text(), spec.numeric)] as const;
      }),
    )
      .then((pairs) => {
        if (!cancelled) setState({ status: "ready", data: Object.fromEntries(pairs) as Record<K, Row[]> });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: "error", message: error.message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export const num = (row: Row, key: string) => row[key] as number;
export const str = (row: Row, key: string) => row[key] as string;
