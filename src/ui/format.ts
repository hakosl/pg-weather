import type { DaySummary } from "../analysis/rating";
import type { FlyState, Measure, ReasonLevel } from "../types";

export const STATE_META: Record<FlyState, { label: string; color: string; meaning: string }> = {
  soar: { label: "Soarable", color: "var(--soar)", meaning: "Flyable, with ridge lift or usable thermals" },
  fly: { label: "Flyable", color: "var(--fly)", meaning: "Safe to fly, but expect a top-to-bottom glide" },
  marginal: { label: "Marginal", color: "var(--marginal)", meaning: "Something needs a closer look: see the reasons" },
  nogo: { label: "No-go", color: "var(--nogo)", meaning: "Rain, too much wind, strong gusts or wind from behind" },
  nodata: { label: "No data", color: "var(--nodata)", meaning: "Not rated yet, or outside this model's range" },
};

export const REASON_COLOR: Record<ReasonLevel, string> = {
  nogo: "var(--nogo)",
  warn: "var(--marginal)",
  good: "var(--soar)",
  info: "var(--nodata)",
};

export const MEASURE_LABEL: Record<Measure, string> = {
  rain: "rain",
  launchWind: "strong launch wind",
  windAbove: "strong wind above launch",
  gusts: "gusts",
  behind: "wind from behind",
  tailwind: "tailwind",
  crosswind: "crosswind",
  direction: "marginal wind direction",
  unknownDirection: "unknown launch direction",
  lowCloud: "low cloud",
  overdevelopment: "overdevelopment",
};

const MAX_BLOCKERS = 3;

export const measuresText = (measures: Measure[]) => measures.map((m) => MEASURE_LABEL[m]).join(", ");

export const blockersText = (blockers: DaySummary["blockers"]) =>
  blockers
    .slice(0, MAX_BLOCKERS)
    .map((b) => `${MEASURE_LABEL[b.measure]} (${b.hours} h)`)
    .join(", ");

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

export const hourOf = (iso: string) => Number(iso.slice(11, 13));
export const pad2 = (n: number) => String(n).padStart(2, "0");
// Non-breaking space keeps the number and its unit on one line in narrow columns.
export const fmtM = (v: number) => `${Math.round(v).toLocaleString("en-GB")}\u00a0m`;
