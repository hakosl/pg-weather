export const FAVORITES_KEY = "pg-weather:favorites";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;
/** A getter, because merely touching localStorage throws in browsers that block site data. */
export type StorageGetter = () => KeyValueStore;

/** Favorite site ids in the order they were added, keeping only sites that still exist. */
export function loadFavorites(storage: StorageGetter, known: Set<string>): string[] {
  try {
    const saved: unknown = JSON.parse(storage().getItem(FAVORITES_KEY) ?? "[]");
    if (Array.isArray(saved)) return [...new Set(saved.filter((id): id is string => typeof id === "string" && known.has(id)))];
  } catch (err) {
    console.warn("Could not read favorites", err);
  }
  return [];
}

/** False when the browser won't keep them, so the caller can say favorites last only until the page closes. */
export function saveFavorites(storage: StorageGetter, ids: string[]): boolean {
  try {
    storage().setItem(FAVORITES_KEY, JSON.stringify(ids));
    return true;
  } catch (err) {
    console.warn("Could not save favorites", err);
    return false;
  }
}

export const toggleFavorite = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
