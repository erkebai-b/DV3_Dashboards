import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsvServer } from "./csv-server";

const DATA = path.join(process.cwd(), "public", "data");

export function readMeta(): { refreshed_at: string; dashboards: Record<string, Record<string, { latest_observation: string | null; rows: number }>> } {
  return JSON.parse(readFileSync(path.join(DATA, "meta.json"), "utf8"));
}

export function readCsv(file: string, numeric: string[]) {
  return parseCsvServer(readFileSync(path.join(DATA, file), "utf8"), numeric);
}
