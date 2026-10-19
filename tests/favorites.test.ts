import { describe, expect, it, vi } from "vitest";
import { FAVORITES_KEY, loadFavorites, saveFavorites, toggleFavorite } from "../src/favorites";

function fakeStorage(saved: Record<string, string> = {}) {
  const data = new Map(Object.entries(saved));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

const known = new Set(["sundvollen", "hydnefossen", "ulriken"]);

describe("loadFavorites", () => {
  it("returns the saved sites in the order they were added", () => {
    const storage = fakeStorage({ [FAVORITES_KEY]: JSON.stringify(["ulriken", "sundvollen"]) });
    expect(loadFavorites(() => storage, known)).toEqual(["ulriken", "sundvollen"]);
  });

  it("drops sites no longer in the site list, duplicates and junk", () => {
    const storage = fakeStorage({ [FAVORITES_KEY]: JSON.stringify(["gone", "sundvollen", 7, null, "sundvollen"]) });
    expect(loadFavorites(() => storage, known)).toEqual(["sundvollen"]);
  });

  it("starts empty when nothing is saved, the value is not a list, or storage is blocked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadFavorites(() => fakeStorage(), known)).toEqual([]);
    expect(loadFavorites(() => fakeStorage({ [FAVORITES_KEY]: "{not json" }), known)).toEqual([]);
    expect(loadFavorites(() => fakeStorage({ [FAVORITES_KEY]: '{"sundvollen":true}' }), known)).toEqual([]);
    expect(loadFavorites(blocked, known)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("saveFavorites", () => {
  it("survives a reload", () => {
    const storage = fakeStorage();
    expect(saveFavorites(() => storage, ["hydnefossen", "sundvollen"])).toBe(true);
    expect(loadFavorites(() => storage, known)).toEqual(["hydnefossen", "sundvollen"]);
  });

  it("reports when the browser will not keep them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(saveFavorites(blocked, ["sundvollen"])).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("toggleFavorite", () => {
  it("adds a site at the end and removes it again, leaving the original list alone", () => {
    const before = ["sundvollen"];
    const added = toggleFavorite(before, "ulriken");
    expect(added).toEqual(["sundvollen", "ulriken"]);
    expect(toggleFavorite(added, "sundvollen")).toEqual(["ulriken"]);
    expect(before).toEqual(["sundvollen"]);
  });
});
