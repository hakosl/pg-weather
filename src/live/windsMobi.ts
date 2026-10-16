import type { Site } from "../types";

const API_URL = "https://winds.mobi/api/2.3";
export const NEAR_DISTANCE_M = 3000;
const MAX_STATIONS = 3;
const KMH_PER_MS = 3.6;
export const HISTORY_DURATION_S = 2 * 60 * 60;
/** Stations report every few minutes; five keeps the panel current without hammering a community service. */
export const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;
export const STALE_AFTER_S = 30 * 60;

export interface Measure {
  /** Unix seconds. */
  at: number;
  direction: number | null;
  avgMs: number | null;
  gustMs: number | null;
  tempC: number | null;
}

export interface Station {
  id: string;
  name: string;
  provider: string;
  lat: number;
  lon: number;
  altM: number | null;
  distanceM: number;
  last: Measure | null;
  links: { label: string; href: string }[];
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface LiveOptions {
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  now?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function toMeasure(raw: unknown): Measure | null {
  const m = (raw ?? {}) as Record<string, unknown>;
  const at = num(m._id);
  if (at == null) return null;
  const speed = (key: string) => {
    const kmh = num(m[key]);
    return kmh == null ? null : kmh / KMH_PER_MS;
  };
  return { at, direction: num(m["w-dir"]), avgMs: speed("w-avg"), gustMs: speed("w-max"), tempC: num(m.temp) };
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function stationLinks(id: string): Station["links"] {
  const holfuy = /^holfuy-(\d+)$/.exec(id);
  return [
    ...(holfuy ? [{ label: "Holfuy", href: `https://holfuy.com/en/weather/${holfuy[1]}` }] : []),
    { label: "winds.mobi", href: `https://winds.mobi/stations/${encodeURIComponent(id)}` },
  ];
}

function toStation(raw: unknown, site: Site): Station | null {
  const s = (raw ?? {}) as Record<string, unknown>;
  const id = str(s._id);
  const coords = (s.loc as { coordinates?: unknown } | undefined)?.coordinates;
  const lon = Array.isArray(coords) ? num(coords[0]) : null;
  const lat = Array.isArray(coords) ? num(coords[1]) : null;
  if (!id || lat == null || lon == null) return null;
  return {
    id,
    name: str(s.short) ?? str(s.name) ?? id,
    provider: str(s["pv-name"]) ?? "",
    lat,
    lon,
    altM: num(s.alt),
    distanceM: distanceM(site, { lat, lon }),
    last: toMeasure(s.last),
    links: stationLinks(id),
  };
}

export function parseStations(raw: unknown, site: Site): Station[] {
  if (!Array.isArray(raw)) throw new Error("winds.mobi returned an unexpected response");
  return raw
    .map((s) => toStation(s, site))
    .filter((s): s is Station => s != null && s.distanceM <= NEAR_DISTANCE_M)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_STATIONS);
}

export function stationsUrl(site: Site): string {
  const params = new URLSearchParams({
    "near-lat": String(site.lat),
    "near-lon": String(site.lon),
    "near-distance": String(NEAR_DISTANCE_M),
    limit: String(MAX_STATIONS),
    "is-highest-duplicates-rating": "true",
  });
  const keys = ["short", "name", "alt", "loc", "pv-name", "last._id", "last.w-dir", "last.w-avg", "last.w-max", "last.temp"];
  for (const key of keys) params.append("keys", key);
  return `${API_URL}/stations/?${params}`;
}

const cache = new Map<string, { at: number; body: unknown }>();

async function getJson(url: string, opts: LiveOptions): Promise<unknown> {
  const now = opts.now ?? Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < LIVE_CACHE_TTL_MS) return hit.body;
  let res: Response;
  try {
    res = await (opts.fetchFn ?? fetch)(url, { signal: opts.signal });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new Error("Could not reach winds.mobi. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`winds.mobi: HTTP ${res.status}`);
  const body = await res.json();
  cache.set(url, { at: now, body });
  return body;
}

/** Weather stations within reach of the launch, with their latest measure. */
export async function nearbyStations(site: Site, opts: LiveOptions = {}): Promise<Station[]> {
  return parseStations(await getJson(stationsUrl(site), opts), site);
}

/** The station's measures over the last two hours, oldest first. */
export async function stationHistory(stationId: string, opts: LiveOptions = {}): Promise<Measure[]> {
  const params = new URLSearchParams({ duration: String(HISTORY_DURATION_S) });
  for (const key of ["w-dir", "w-avg", "w-max"]) params.append("keys", key);
  const body = await getJson(`${API_URL}/stations/${encodeURIComponent(stationId)}/historic/?${params}`, opts);
  if (!Array.isArray(body)) throw new Error("winds.mobi returned an unexpected history");
  return body
    .map(toMeasure)
    .filter((m): m is Measure => m != null)
    .sort((a, b) => a.at - b.at);
}
