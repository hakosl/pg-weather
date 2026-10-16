import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { FORECAST_TTL_MS, browserStore, memoryStore, type CacheEntry } from "../src/forecast/cache";
import { RateLimitError } from "../src/forecast/client";
import { loadSiteModels, rateSites } from "../src/forecast/overview";
import { loadFixture, makeSite, sundvollen } from "./helpers";

const range = { start: "2026-10-17", end: "2026-10-18" };
const fixture = loadFixture("sundvollen-icon.json");

function fakeFetch() {
  return vi.fn(async (url: string) => {
    const n = new URL(url).searchParams.get("latitude")!.split(",").length;
    return { ok: true, status: 200, json: async () => (n === 1 ? fixture : Array(n).fill(fixture)) } as Response;
  });
}

const entry = (at: number): CacheEntry => ({ at, start: range.start, end: range.end, raw: { at } });

describe("browserStore", () => {
  it("keeps entries across page loads and prunes expired ones", async () => {
    await browserStore("store-test").setMany([
      ["old", entry(0)],
      ["new", entry(FORECAST_TTL_MS)],
    ]);
    const reloaded = browserStore("store-test");
    expect((await reloaded.getMany(["old", "new", "none"])).map((e) => e?.at)).toEqual([0, FORECAST_TTL_MS, undefined]);
    await reloaded.prune(FORECAST_TTL_MS + 1);
    expect(await reloaded.getMany(["old", "new"])).toEqual([undefined, entry(FORECAST_TTL_MS)]);
  });
});

describe("rateSites", () => {
  it("rates each day from one fetch of the whole range", async () => {
    const fetchFn = fakeFetch();
    const store = memoryStore();
    const saturday = (await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store, fetchFn })).get("sundvollen")!;
    expect(saturday.hours).toHaveLength(24);
    expect(saturday.summary.state).toBe("soar");
    const sunday = (await rateSites([sundvollen], range, "2026-10-18", "icon_seamless", { store, fetchFn })).get("sundvollen")!;
    expect(sunday.summary.state).toBe("fly");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("serves a reloaded page from the browser cache", async () => {
    const fetchFn = fakeFetch();
    await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store: browserStore("reload-test"), fetchFn, now: 1000 });
    const again = await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store: browserStore("reload-test"), fetchFn, now: 2000 });
    expect(again.get("sundvollen")!.summary.state).toBe("soar");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refetches expired forecasts and a new day range", async () => {
    const fetchFn = fakeFetch();
    const store = memoryStore();
    await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store, fetchFn, now: 0 });
    await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store, fetchFn, now: FORECAST_TTL_MS });
    await rateSites([sundvollen], { ...range, start: "2026-10-18" }, "2026-10-18", "icon_seamless", { store, fetchFn, now: FORECAST_TTL_MS });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("keeps the batches that arrived before a rate limit", async () => {
    const sites = Array.from({ length: 60 }, (_, i) => makeSite({ id: `s${i}` }));
    const store = memoryStore();
    const ok = fakeFetch();
    const flaky = vi.fn(async (url: string) =>
      flaky.mock.calls.length === 1
        ? ok(url)
        : ({ ok: false, status: 429, json: async () => ({ reason: "Minutely API request limit exceeded." }) } as Response),
    );
    await expect(rateSites(sites, range, "2026-10-17", "icon_seamless", { store, fetchFn: flaky })).rejects.toBeInstanceOf(RateLimitError);
    const retry = fakeFetch();
    const rated = await rateSites(sites, range, "2026-10-17", "icon_seamless", { store, fetchFn: retry });
    expect(rated.size).toBe(60);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(new URL(retry.mock.calls[0][0]).searchParams.get("latitude")!.split(",")).toHaveLength(10);
  });

  it("treats an unavailable cache as empty instead of failing", async () => {
    const broken = { getMany: async () => Promise.reject(new Error("blocked")), setMany: async () => Promise.reject(new Error("blocked")), prune: async () => {} };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rated = await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store: broken, fetchFn: fakeFetch() });
    expect(rated.get("sundvollen")!.summary.state).toBe("soar");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("loadSiteModels", () => {
  it("reuses the map's model from the cache and fetches the other three", async () => {
    const store = memoryStore();
    const fetchFn = fakeFetch();
    await rateSites([sundvollen], range, "2026-10-17", "icon_seamless", { store, fetchFn, now: 5000 });
    const forecasts = await loadSiteModels(sundvollen, range, { store, fetchFn, now: 6000 });
    expect(forecasts.map((f) => f.model)).toEqual(["ecmwf_ifs025", "icon_seamless", "gfs_seamless", "metno_nordic"]);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(forecasts.find((f) => f.model === "icon_seamless")!.fetchedAt).toBe(5000);
  });
});
