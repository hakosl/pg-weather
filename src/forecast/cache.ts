import { createStore, delMany, entries, getMany, setMany } from "idb-keyval";

/** Models update every 1–6 hours; two hours keeps the API quota low without going stale. */
export const FORECAST_TTL_MS = 2 * 60 * 60 * 1000;

/** One model's raw Open-Meteo response for one site and day range. */
export interface CacheEntry {
  at: number;
  start: string;
  end: string;
  raw: unknown;
}

export interface ForecastStore {
  getMany(keys: string[]): Promise<(CacheEntry | undefined)[]>;
  setMany(items: [string, CacheEntry][]): Promise<void>;
  prune(now: number): Promise<void>;
}

const expired = (e: CacheEntry, now: number) => now - e.at >= FORECAST_TTL_MS;

export function memoryStore(): ForecastStore {
  const map = new Map<string, CacheEntry>();
  return {
    getMany: async (keys) => keys.map((k) => map.get(k)),
    setMany: async (items) => {
      for (const [k, v] of items) map.set(k, v);
    },
    prune: async (now) => {
      for (const [k, v] of map) if (expired(v, now)) map.delete(k);
    },
  };
}

/** Survives reloads via IndexedDB; falls back to memory where IndexedDB is missing. */
export function browserStore(dbName = "pg-weather"): ForecastStore {
  if (typeof indexedDB === "undefined") return memoryStore();
  const db = createStore(dbName, "forecasts");
  return {
    getMany: (keys) => getMany<CacheEntry>(keys, db),
    setMany: (items) => setMany(items, db),
    prune: async (now) => {
      const all = await entries<string, CacheEntry>(db);
      const old = all.filter(([, e]) => expired(e, now)).map(([k]) => k);
      if (old.length > 0) await delMany(old, db);
    },
  };
}
