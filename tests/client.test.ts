import { describe, expect, it, vi } from "vitest";
import { RateLimitError, fetchLocations, forecastUrl } from "../src/forecast/client";
import { sundvollen } from "./helpers";

const range = { start: "2026-10-17", end: "2026-10-18" };
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const limited = (reason: string) =>
  vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: true, reason }) }) as Response);

describe("forecastUrl", () => {
  it("asks for the whole day range in m/s with sunrise and sunset", () => {
    const p = new URL(forecastUrl([{ lat: 60.05, lon: 10.32 }], range, "icon_seamless")).searchParams;
    expect(p.get("latitude")).toBe("60.05");
    expect(p.get("start_date")).toBe("2026-10-17");
    expect(p.get("end_date")).toBe("2026-10-18");
    expect(p.get("wind_speed_unit")).toBe("ms");
    expect(p.get("timezone")).toBe("Europe/Oslo");
    expect(p.get("daily")).toBe("sunrise,sunset");
    expect(p.get("models")).toBe("icon_seamless");
    expect(p.get("hourly")).toContain("wind_speed_950hPa");
  });

  it("skips pressure levels for MEPS, which has none", () => {
    const p = new URL(forecastUrl([{ lat: 60, lon: 10 }], range, "metno_nordic")).searchParams;
    expect(p.get("hourly")).not.toContain("hPa");
  });
});

describe("fetchLocations", () => {
  it("returns one result per location for single and multi-location responses", async () => {
    const one = await fetchLocations([sundvollen], range, "icon_seamless", vi.fn(async () => okJson({ a: 1 })));
    expect(one).toEqual([{ a: 1 }]);
    const two = await fetchLocations([sundvollen, sundvollen], range, "icon_seamless", vi.fn(async () => okJson([{ a: 1 }, { a: 2 }])));
    expect(two).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("rejects a response with the wrong number of locations", async () => {
    const fetchFn = vi.fn(async () => okJson([{ a: 1 }]));
    await expect(fetchLocations([sundvollen, sundvollen], range, "icon_seamless", fetchFn)).rejects.toThrow(/unexpected number/);
  });

  it("asks to retry after a minute when the per-minute limit is hit", async () => {
    const fetchFn = limited("Minutely API request limit exceeded. Please try again in one minute.");
    const err = await fetchLocations([sundvollen], range, "icon_seamless", fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(60_000);
    expect(err.message).toMatch(/Retrying in a minute/);
  });

  it("does not retry when the hourly limit is used up", async () => {
    const fetchFn = limited("Hourly API request limit exceeded. Please try again in the next hour.");
    const err = await fetchLocations([sundvollen], range, "icon_seamless", fetchFn).catch((e) => e);
    expect(err.retryAfterMs).toBeNull();
    expect(err.message).toMatch(/this hour's requests/);
  });

  it("explains an unreachable API", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchLocations([sundvollen], range, "icon_seamless", fetchFn)).rejects.toThrow(/Could not reach Open-Meteo/);
  });
});
