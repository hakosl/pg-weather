import { describe, expect, it } from "vitest";
import { hoursForDay, parseForecast } from "../src/forecast/parse";
import { loadFixture } from "./helpers";

const at = <T extends { time: string }>(hours: T[], time: string): T => hours.find((h) => h.time === time)!;

describe("parseForecast", () => {
  it("reads a single-model response into hours with pressure levels", () => {
    const f = parseForecast(loadFixture("sundvollen-icon.json"), "icon_seamless");
    expect(f.groundElevation).toBe(297);
    expect(f.hours).toHaveLength(48);
    const h = at(f.hours, "2026-10-17T14:00");
    expect(h.levels.map((l) => l.pressure)).toEqual([975, 950, 925, 900, 850, 800, 700]);
    const l950 = h.levels.find((l) => l.pressure === 950)!;
    expect(l950.wind).toEqual({ speed: 5.16, direction: 1 });
    expect(l950.heightM).toBeGreaterThan(600);
    expect(l950.heightM).toBeLessThan(700);
    expect(h.gust10m).toBe(7.2);
  });

  it("drops levels a model does not provide", () => {
    const f = parseForecast(loadFixture("hydnefossen-meps.json"), "metno_nordic");
    const h = at(f.hours, "2026-10-17T14:00");
    expect(h.levels).toEqual([]);
    expect(h.wind10m).toEqual({ speed: 6.5, direction: 319 });
    expect(h.gust10m).toBe(11.7);
  });

  it("falls back to standard heights when a level has wind but no geopotential height", () => {
    const raw = {
      elevation: 300,
      hourly: { time: ["2026-10-17T12:00"], wind_speed_925hPa: [6], wind_direction_925hPa: [10], geopotential_height_925hPa: [null] },
    };
    expect(parseForecast(raw, "ecmwf_ifs025").hours[0].levels).toEqual([
      { pressure: 925, heightM: 760, wind: { speed: 6, direction: 10 }, temperature: null },
    ]);
  });

  it("keeps sunrise and sunset per day", () => {
    const raw = {
      elevation: 300,
      hourly: { time: ["2026-10-17T12:00"] },
      daily: { time: ["2026-10-17", "2026-10-18"], sunrise: ["2026-10-17T08:05", "2026-10-18T08:07"], sunset: ["2026-10-17T18:04", "2026-10-18T18:01"] },
    };
    expect(parseForecast(raw, "icon_seamless").daylight["2026-10-18"]).toEqual({
      sunrise: "2026-10-18T08:07",
      sunset: "2026-10-18T18:01",
    });
  });

  it("rejects error responses and malformed payloads with a readable message", () => {
    expect(() => parseForecast({ error: true, reason: "Too many requests" }, "icon_seamless")).toThrow(
      "Too many requests",
    );
    expect(() => parseForecast({ hourly: {} }, "icon_seamless")).toThrow(/no hourly data/);
  });
});

describe("hoursForDay", () => {
  it("keeps only the hours of the given local day", () => {
    const f = parseForecast(loadFixture("sundvollen-icon.json"), "icon_seamless");
    const sunday = hoursForDay(f, "2026-10-18");
    expect(sunday).toHaveLength(24);
    expect(sunday[0].time).toBe("2026-10-18T00:00");
  });
});
