"use client";

import { useEffect, useState } from "react";
import { loadIsoNumeric } from "./maps";

export function useIsoNumeric(): Record<string, string> | null {
  const [map, setMap] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    loadIsoNumeric().then(setMap).catch(() => setMap({}));
  }, []);
  return map;
}
