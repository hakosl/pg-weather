import type { ModelId } from "../types";
import { HOURLY_VARIABLES, SURFACE_VARIABLES, TIME_ZONE } from "./parse";

export const MODELS: { id: ModelId; label: string; detail: string }[] = [
  { id: "ecmwf_ifs025", label: "ECMWF", detail: "ECMWF IFS, 25 km grid" },
  { id: "icon_seamless", label: "ICON", detail: "DWD ICON, 7–13 km grid" },
  { id: "gfs_seamless", label: "GFS", detail: "NOAA GFS, 13–25 km grid" },
  { id: "metno_nordic", label: "MEPS", detail: "MET Norway MEPS, 2.5 km grid, near-ground wind only" },
];

const API_URL = "https://api.open-meteo.com/v1/forecast";
// Keeps the request URL comfortably short.
export const BATCH_SIZE = 50;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Local days to fetch. Open-Meteo charges the same for up to 14 days, so the app fetches its whole range at once. */
export interface DayRange {
  start: string;
  end: string;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

const MINUTE_MS = 60_000;

function rateLimitError(reason: string): RateLimitError {
  if (/minute/i.test(reason))
    return new RateLimitError("Open-Meteo's free tier allows 600 requests a minute. Retrying in a minute…", MINUTE_MS);
  const period = /daily/i.test(reason) ? "today's" : "this hour's";
  return new RateLimitError(`Open-Meteo's free limit for ${period} requests is used up. Try again later.`, null);
}

export function forecastUrl(points: { lat: number; lon: number }[], range: DayRange, model: ModelId): string {
  const surfaceOnly = model === "metno_nordic";
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly: (surfaceOnly ? SURFACE_VARIABLES : HOURLY_VARIABLES).join(","),
    daily: "sunrise,sunset",
    wind_speed_unit: "ms",
    timezone: TIME_ZONE,
    start_date: range.start,
    end_date: range.end,
    models: model,
  });
  return `${API_URL}?${params}`;
}

async function getJson(url: string, fetchFn: FetchFn, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("Could not reach Open-Meteo. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { reason?: string } | null;
  if (res.status === 429) throw rateLimitError(body?.reason ?? "");
  if (!res.ok) throw new Error(`Open-Meteo: ${body?.reason ?? `HTTP ${res.status}`}`);
  return body;
}

/** One request for up to BATCH_SIZE locations; returns each location's raw response in order. */
export async function fetchLocations(
  points: { lat: number; lon: number }[],
  range: DayRange,
  model: ModelId,
  fetchFn: FetchFn = fetch,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const body = await getJson(forecastUrl(points, range, model), fetchFn, signal);
  const locations = Array.isArray(body) ? body : [body];
  if (locations.length !== points.length) throw new Error("Open-Meteo returned an unexpected number of locations");
  return locations;
}
