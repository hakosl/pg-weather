import { rateHour, summarizeDay, type DaySummary, type HourRating } from "../analysis/rating";
import type { ModelForecast, ModelId, Site } from "../types";
import { FORECAST_TTL_MS, type CacheEntry, type ForecastStore } from "./cache";
import { BATCH_SIZE, MODELS, fetchLocations, type DayRange, type FetchFn } from "./client";
import { hoursForDay, parseForecast } from "./parse";

export interface SiteDay {
  hours: HourRating[];
  summary: DaySummary;
}

export interface LoadOptions {
  store: ForecastStore;
  fetchFn?: FetchFn;
  signal?: AbortSignal;
  now?: number;
  /** Called with the number of sites in each request sent to Open-Meteo. */
  onFetched?: (sites: number) => void;
}

const cacheKey = (model: ModelId, siteId: string) => `${model}|${siteId}`;
const toForecast = (e: CacheEntry, model: ModelId): ModelForecast => ({ ...parseForecast(e.raw, model), fetchedAt: e.at });

export function rateForecast(site: Site, forecast: ModelForecast, day: string): SiteDay {
  const light = forecast.daylight[day];
  const hours = hoursForDay(forecast, day).map((h) => rateHour(site, h, forecast.groundElevation, light));
  return { hours, summary: summarizeDay(hours, light?.sunrise ?? null, light?.sunset ?? null) };
}

async function cachedEntries(store: ForecastStore, keys: string[]): Promise<(CacheEntry | undefined)[]> {
  try {
    return await store.getMany(keys);
  } catch (err) {
    console.warn("Forecast cache unavailable, fetching instead", err);
    return keys.map(() => undefined);
  }
}

/** One model's forecasts for the day range: fresh cache entries first, then the rest fetched batch by batch. */
export async function loadForecasts(
  sites: Site[],
  range: DayRange,
  model: ModelId,
  opts: LoadOptions,
): Promise<Map<string, ModelForecast>> {
  const now = opts.now ?? Date.now();
  const entries = await cachedEntries(opts.store, sites.map((s) => cacheKey(model, s.id)));
  const result = new Map<string, ModelForecast>();
  const missing: Site[] = [];
  sites.forEach((site, i) => {
    const e = entries[i];
    const fresh = e && e.start === range.start && e.end === range.end && now - e.at < FORECAST_TTL_MS;
    if (fresh) result.set(site.id, toForecast(e, model));
    else missing.push(site);
  });
  // Each batch is cached as it arrives, so a rate limit halfway only costs the batches still missing.
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const raws = await fetchLocations(batch, range, model, opts.fetchFn, opts.signal);
    opts.onFetched?.(batch.length);
    const items = batch.map((site, j): [string, CacheEntry] => [
      cacheKey(model, site.id),
      { at: now, start: range.start, end: range.end, raw: raws[j] },
    ]);
    items.forEach(([, e], j) => result.set(batch[j].id, toForecast(e, model)));
    await opts.store.setMany(items).catch((err) => console.warn("Could not cache forecasts", err));
  }
  return result;
}

export async function rateSites(
  sites: Site[],
  range: DayRange,
  day: string,
  model: ModelId,
  opts: LoadOptions,
): Promise<Map<string, SiteDay>> {
  const forecasts = await loadForecasts(sites, range, model, opts);
  const result = new Map<string, SiteDay>();
  for (const site of sites) {
    const forecast = forecasts.get(site.id);
    if (forecast) result.set(site.id, rateForecast(site, forecast, day));
  }
  return result;
}

/** All four models for one site; models already cached, such as the map's, cost nothing. */
export async function loadSiteModels(site: Site, range: DayRange, opts: LoadOptions): Promise<ModelForecast[]> {
  const perModel = await Promise.all(MODELS.map((m) => loadForecasts([site], range, m.id, opts)));
  return perModel.map((forecasts) => forecasts.get(site.id)!);
}
