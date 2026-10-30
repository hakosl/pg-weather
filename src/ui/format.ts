import { LIMITS, limitingMeasures, type DaySummary, type HourRating } from "../analysis/rating";
import type { SiteDay } from "../forecast/overview";
import type { FlyState, HourSample, Measure, Reason, ReasonLevel } from "../types";

export const STATE_META: Record<FlyState, { label: string; color: string; meaning: string }> = {
  soar: { label: "Soarable", color: "var(--soar)", meaning: "Flyable, with ridge lift or usable thermals" },
  fly: { label: "Flyable", color: "var(--fly)", meaning: "Safe to fly, but expect a top-to-bottom glide" },
  marginal: { label: "Marginal", color: "var(--marginal)", meaning: "Something needs a closer look: see the reasons" },
  nogo: { label: "No-go", color: "var(--nogo)", meaning: "Rain, too much wind, strong gusts, wind from behind or darkness" },
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
  dark: "darkness",
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

const FIRST_HOUR = 6;
const LAST_HOUR = 21;
export const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

export function pill(state: FlyState): HTMLElement {
  const node = el("span", { class: "state-pill" }, STATE_META[state].label);
  node.style.background = STATE_META[state].color;
  return node;
}

const CLEAR_MAX_PCT = 25;
const PARTLY_MAX_PCT = 70;

/** An icon for the hour's sky: rain first, then night, then how much cloud; null when the model gives no cloud cover. */
export function sky(r: { sample: Pick<HourSample, "cloudCover" | "precipitation">; reasons: Reason[] }): { icon: string; label: string } | null {
  const { cloudCover, precipitation } = r.sample;
  if (precipitation != null && precipitation >= LIMITS.rainWarn) return { icon: "🌧️", label: `Rain, ${precipitation.toFixed(1)} mm` };
  if (r.reasons.some((x) => x.measure === "dark" && x.level === "nogo")) return { icon: "🌙", label: "Dark" };
  if (cloudCover == null) return null;
  const cloud = `${Math.round(cloudCover)}% cloud`;
  if (cloudCover <= CLEAR_MAX_PCT) return { icon: "☀️", label: `Clear, ${cloud}` };
  if (cloudCover <= PARTLY_MAX_PCT) return { icon: "⛅", label: `Partly cloudy, ${cloud}` };
  return { icon: "☁️", label: `Overcast, ${cloud}` };
}

/** The picked hour's rating, or null for the whole day. */
export const slotAt = (day: SiteDay, hour: number | null): HourRating | null =>
  hour == null ? null : day.hours.find((h) => hourOf(h.time) === hour) ?? null;

export const stateAt = (day: SiteDay, slot: HourRating | null): FlyState => (slot ? slot.state : day.summary.state ?? "nodata");

/** What holds the hour or the day back, else the day's flyable window. */
export function ratingNote(day: SiteDay, slot: HourRating | null): string {
  if (slot) return measuresText(limitingMeasures(slot));
  if (day.summary.blockers.length) return blockersText(day.summary.blockers);
  const w = day.summary.window;
  return w ? `${w.start}–${w.end}` : "";
}
