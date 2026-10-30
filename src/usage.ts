import type { StorageGetter } from "./favorites";

export const USAGE_KEY = "pg-weather:open-meteo-usage";
/** Open-Meteo's free tier allows 10,000 calls a day. */
export const DAILY_LIMIT = 10_000;

/** Sites this browser has requested from Open-Meteo on the given day. */
export function usageToday(storage: StorageGetter, day: string): number {
  try {
    const saved = JSON.parse(storage().getItem(USAGE_KEY) ?? "null") as { day?: unknown; sites?: unknown } | null;
    return saved?.day === day && typeof saved.sites === "number" ? saved.sites : 0;
  } catch (err) {
    console.warn("Could not read Open-Meteo usage", err);
    return 0;
  }
}

/** Adds the sites to the day's count and returns the new total; a new day starts from zero. */
export function recordUsage(storage: StorageGetter, day: string, sites: number): number {
  const total = usageToday(storage, day) + sites;
  try {
    storage().setItem(USAGE_KEY, JSON.stringify({ day, sites: total }));
  } catch (err) {
    console.warn("Could not save Open-Meteo usage", err);
  }
  return total;
}
