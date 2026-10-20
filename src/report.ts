import { compass } from "./analysis/wind";
import { MODELS, type FetchFn } from "./forecast/client";
import { rateForecast, type SiteDay } from "./forecast/overview";
import { TIME_ZONE } from "./forecast/parse";
import type { ModelForecast, ModelId, Site } from "./types";
import { STATE_META, blockersText } from "./ui/format";

// One model alone is too often an outlier days ahead, so a day only counts when another agrees.
export const MIN_AGREEING_MODELS = 2;
const APP_URL = "https://hakosl.github.io/pg-weather/";
const NTFY_URL = "https://ntfy.sh/";

export type ModelResult = { model: ModelId; forecasts: Map<string, ModelForecast> } | { model: ModelId; error: string };

export interface SiteReport {
  site: Site;
  day: string;
  models: { model: ModelId; day: SiteDay }[];
}

const osloDate = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (day: string) => dayFormat.format(new Date(`${day}T12:00Z`)).replace(",", "");
const modelLabel = (id: ModelId) => MODELS.find((m) => m.id === id)!.label;

/** Today's date in Oslo and the days after it, as YYYY-MM-DD. */
export function osloDays(now: number, count: number): string[] {
  const [y, m, d] = osloDate.format(now).split("-").map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

export function buildReports(sites: Site[], days: string[], results: ModelResult[]): SiteReport[] {
  return sites.flatMap((site) =>
    days.map((day) => ({
      site,
      day,
      models: results.flatMap((r) => {
        const forecast = "forecasts" in r ? r.forecasts.get(site.id) : undefined;
        return forecast ? [{ model: r.model, day: rateForecast(site, forecast, day) }] : [];
      }),
    })),
  );
}

// A day only rates soarable with at least two soarable hours in a row.
const soaring = (r: SiteReport) => r.models.filter((m) => m.day.summary.state === "soar");

export const isSoarable = (r: SiteReport) => soaring(r).length >= MIN_AGREEING_MODELS;

function windNote(day: SiteDay, window: { start: string; end: string }): string {
  const winds = day.hours.flatMap((h) => {
    const clock = h.time.slice(11, 16);
    return clock >= window.start && clock < window.end && h.launchWind ? [h.launchWind] : [];
  });
  if (winds.length === 0) return "";
  const speeds = winds.map((w) => w.speed);
  const middle = winds[Math.floor(winds.length / 2)];
  return `, launch wind ${Math.min(...speeds).toFixed(1)}–${Math.max(...speeds).toFixed(1)} m/s from ${compass(middle.direction)}`;
}

function modelLine({ model, day }: SiteReport["models"][number]): string {
  const { state, window, blockers } = day.summary;
  const label = `  ${modelLabel(model).padEnd(7)}${STATE_META[state ?? "nodata"].label.toLowerCase()}`;
  const span = window ? ` ${window.start}–${window.end}` : "";
  if (window && (state === "fly" || state === "soar")) return `${label}${span}${windNote(day, window)}`;
  return `${label}${span}${blockers.length ? `: ${blockersText(blockers)}` : ""}`;
}

const block = (r: SiteReport) => [
  `${r.site.name}, ${dayLabel(r.day)}: ${soaring(r).length} of ${r.models.length} models soarable`,
  ...r.models.map(modelLine),
];
const siteDays = (reports: SiteReport[]) => reports.map((r) => `${r.site.name} ${dayLabel(r.day)}`).join("; ");

/** Plain text for the log: the verdict on the first line, then each site's day model by model. */
export function formatReport(reports: SiteReport[], results: ModelResult[]): string {
  const good = reports.filter(isSoarable);
  const headline = good.length ? `SOARABLE: ${siteDays(good)}` : "NOTHING SOARABLE";
  const failed = results.flatMap((r) => ("error" in r ? [`${modelLabel(r.model)} failed: ${r.error}`] : []));
  return [headline, ...failed, ...reports.flatMap((r) => ["", ...block(r)])].join("\n");
}

export interface Alert {
  title: string;
  message: string;
}

/** The notification for the soarable days, or null when there are none. */
export function alertFor(reports: SiteReport[]): Alert | null {
  const good = reports.filter(isSoarable);
  return good.length ? { title: `Soarable: ${siteDays(good)}`, message: good.map((r) => block(r).join("\n")).join("\n\n") } : null;
}

// JSON publishing keeps names like Solbergåsen intact, which ntfy's title header would mangle.
export async function sendAlert(topic: string, alert: Alert, fetchFn: FetchFn = fetch): Promise<void> {
  const res = await fetchFn(NTFY_URL, { method: "POST", body: JSON.stringify({ topic, ...alert, click: APP_URL }) });
  if (!res.ok) throw new Error(`ntfy: HTTP ${res.status} ${await res.text()}`);
}
