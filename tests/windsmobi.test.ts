import { describe, expect, it, vi } from "vitest";
import { NEAR_DISTANCE_M, nearbyStations, parseStations, stationHistory, stationsUrl } from "../src/live/windsMobi";
import { loadFixture, sundvollen } from "./helpers";

const near = loadFixture("windsmobi-near-sundvollen.json");
const history = loadFixture("windsmobi-history-sundvollen.json");
const ok = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response);

describe("stationsUrl", () => {
  it("asks for de-duplicated stations near the launch with only the fields the panel shows", () => {
    const p = new URL(stationsUrl(sundvollen)).searchParams;
    expect(p.get("near-lat")).toBe("60.0533");
    expect(p.get("near-lon")).toBe("10.322");
    expect(p.get("near-distance")).toBe(String(NEAR_DISTANCE_M));
    expect(p.get("is-highest-duplicates-rating")).toBe("true");
    // winds.mobi only accepts the latest measure's fields one by one, not "last" as a whole.
    expect(p.getAll("keys")).toEqual(["short", "name", "alt", "loc", "pv-name", "last._id", "last.w-dir", "last.w-avg", "last.w-max", "last.temp"]);
  });
});

describe("parseStations", () => {
  it("keeps stations within reach of the launch, nearest first, in m/s", () => {
    const stations = parseStations(near, sundvollen);
    expect(stations.map((s) => s.id)).toEqual(["holfuy-395"]);
    const [s] = stations;
    expect(s.name).toBe("OPK Sundvollen");
    expect(s.provider).toBe("holfuy.com");
    expect(s.altM).toBe(372);
    expect(s.distanceM).toBeGreaterThan(50);
    expect(s.distanceM).toBeLessThan(150);
    expect(s.last).toEqual({ at: 1792147694, direction: 160, avgMs: 0, gustMs: 0, tempC: 9.5 });
  });

  it("links Holfuy stations to Holfuy and every station to winds.mobi", () => {
    expect(parseStations(near, sundvollen)[0].links).toEqual([
      { label: "Holfuy", href: "https://holfuy.com/en/weather/395" },
      { label: "winds.mobi", href: "https://winds.mobi/stations/holfuy-395" },
    ]);
  });

  it("skips malformed stations and rejects a malformed response", () => {
    expect(parseStations([{ _id: "x" }, { loc: { coordinates: [10, 60] } }], sundvollen)).toEqual([]);
    expect(() => parseStations({ error: "nope" }, sundvollen)).toThrow(/unexpected response/);
  });
});

describe("stationHistory", () => {
  it("returns the last two hours oldest first, converted from km/h", async () => {
    const measures = await stationHistory("holfuy-395", { fetchFn: ok(history) });
    expect(measures).toHaveLength(17);
    expect(measures[0].at).toBeLessThan(measures[16].at);
    expect(measures[0].avgMs).toBeCloseTo(8 / 3.6);
    expect(measures[0].gustMs).toBeCloseTo(13 / 3.6);
  });
});

describe("nearbyStations", () => {
  it("reuses a recent answer instead of asking winds.mobi again", async () => {
    const fetchFn = ok(near);
    const site = { ...sundvollen, id: "cache-test" };
    await nearbyStations(site, { fetchFn, now: 0 });
    await nearbyStations(site, { fetchFn, now: 60_000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await nearbyStations(site, { fetchFn, now: 10 * 60_000 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("explains failures in plain words", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(nearbyStations({ ...sundvollen, id: "down" }, { fetchFn: down })).rejects.toThrow(/Could not reach winds.mobi/);
    const broken = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    await expect(nearbyStations({ ...sundvollen, id: "broken" }, { fetchFn: broken })).rejects.toThrow(/winds.mobi: HTTP 503/);
  });
});
