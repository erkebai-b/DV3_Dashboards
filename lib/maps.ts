import type { TopLevelSpec } from "vega-lite";

/** US state postal code -> FIPS code used as the feature id in us-atlas. */
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11", FL: "12", GA: "13",
  HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25",
  MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36",
  NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48",
  UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

/** Oryx country-of-origin names -> ISO 3166 alpha-3. */
export const ORIGIN_ISO3: Record<string, string> = {
  Cyprus: "CYP", "Czech Republic": "CZE", Estonia: "EST", Germany: "DEU", Iran: "IRN", Israel: "ISR", Latvia: "LVA",
  Poland: "POL", Russia: "RUS", Turkey: "TUR", Ukraine: "UKR", "United Kingdom": "GBR", "United States": "USA",
  "Soviet Union": "RUS", China: "CHN", France: "FRA", Italy: "ITA", Australia: "AUS", Canada: "CAN",
};

/** Sequential single-hue ramp (validated blue steps). */
export const BLUES = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
/** On a dark surface, larger values should be brighter, so the ramp runs the other way. */
export const blues = (dark: boolean) => (dark ? [...BLUES].reverse() : BLUES);

export type MapRow = Record<string, unknown> & { id: string };

/** A choropleth: a grey base for every feature, then the data layer joined on feature id. */
export function choropleth(opts: {
  url: string; feature: string; projection: "equalEarth" | "albersUsa"; rows: MapRow[]; height: number;
  color: Record<string, unknown>; tooltip: Record<string, unknown>[]; fields: string[]; dark: boolean;
  strokeField?: string;
}): TopLevelSpec {
  const base = opts.dark ? "#2a323d" : "#dde2e6";
  const edge = opts.dark ? "#11161d" : "#ffffff";
  const strongEdge = opts.dark ? "#f0f2f5" : "#18212d";
  const layer: Record<string, unknown>[] = [
    { mark: { type: "geoshape", fill: base, stroke: edge, strokeWidth: 0.5 } },
    {
      transform: [
        { lookup: "id", from: { data: { values: opts.rows }, key: "id", fields: opts.fields } },
        { filter: `isValid(datum['${opts.fields[0]}'])` },
      ],
      mark: { type: "geoshape", stroke: edge, strokeWidth: 0.6 },
      encoding: { color: opts.color, tooltip: opts.tooltip },
    },
  ];
  if (opts.strokeField) {
    layer.push({
      transform: [
        { lookup: "id", from: { data: { values: opts.rows }, key: "id", fields: [opts.strokeField] } },
        { filter: `datum['${opts.strokeField}'] === true` },
      ],
      mark: { type: "geoshape", fill: null, stroke: strongEdge, strokeWidth: 2.2 },
    });
  }
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container", height: opts.height,
    projection: { type: opts.projection },
    data: { url: opts.url, format: { type: "topojson", feature: opts.feature } },
    layer,
  } as unknown as TopLevelSpec;
}

let isoCache: Promise<Record<string, number>> | null = null;
/** ISO alpha-3 -> zero-padded numeric id used in world-atlas. */
export async function loadIsoNumeric(): Promise<Record<string, string>> {
  isoCache ??= fetch("/geo/iso3-numeric.json").then((r) => r.json());
  const raw = await isoCache;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v).padStart(3, "0")]));
}

/** Turn a value into a labelled class for a diverging map legend (breaks ascending, labels length = breaks + 1). */
export function classify(value: number, breaks: number[], labels: string[]): string {
  const index = breaks.findIndex((b) => value < b);
  return labels[index === -1 ? breaks.length : index];
}
