/** Validated categorical palette (fixed order). Colours follow the entity, never its rank. */
export const PALETTE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export function scaleFor(domain: string[], dark: boolean) {
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
  return { domain, range: domain.map((_, i) => palette[i % palette.length]) };
}
