import { describe, expect, it } from "vitest";
import { assessThermals, cloudBase, thermalTop } from "../src/analysis/thermals";
import { parseForecast } from "../src/forecast/parse";
import type { HourSample } from "../src/types";
import { level, loadFixture, sundvollen } from "./helpers";

describe("thermalTop", () => {
  it("lifts a parcel 1 K warmer than the ground along the dry adiabat until it meets the profile", () => {
    const levels = [level(1000, 5, 0, 3.0), level(1500, 5, 0, -2), level(2000, 5, 0, -4)];
    expect(thermalTop(300, 10, levels)).toBeCloseTo(1713.8, 0);
  });

  it("stops just above the ground in a stable profile", () => {
    const top = thermalTop(300, 5, [level(800, 5, 0, 6)]);
    expect(top).toBeGreaterThan(300);
    expect(top).toBeLessThan(400);
  });

  it("caps at the highest level when the parcel never meets the profile", () => {
    expect(thermalTop(300, 20, [level(1000, 5, 0, 0), level(1500, 5, 0, -10)])).toBe(1500);
  });

  it("ignores levels at or below the ground", () => {
    const levels = [level(250, 5, 0, 30), level(1000, 5, 0, 3.0), level(1500, 5, 0, -2), level(2000, 5, 0, -4)];
    expect(thermalTop(300, 10, levels)).toBeCloseTo(1713.8, 0);
  });

  it("returns null without a temperature profile", () => {
    expect(thermalTop(300, 10, [level(1000, 5, 0, null)])).toBeNull();
  });
});

describe("cloudBase", () => {
  it("rises 125 m per degree of dew-point spread", () => {
    expect(cloudBase(300, 8, 0)).toBe(1300);
  });
});

describe("assessThermals strength", () => {
  const sunnyHour = (overrides: Partial<HourSample>): HourSample => ({
    time: "2026-10-17T13:00",
    temperature2m: 10,
    dewPoint2m: 0,
    wind10m: null,
    gust10m: null,
    precipitation: 0,
    cloudCover: 0,
    cloudCoverLow: 0,
    shortwave: 0,
    heatFlux: null,
    cape: 0,
    levels: [level(1000, 5, 0, 3.0), level(1500, 5, 0, -2), level(2000, 5, 0, -4)],
    ...overrides,
  });

  it("uses the model's heat flux when it has one, and 30% of the sunshine when it doesn't", () => {
    const fromModel = assessThermals(sunnyHour({ heatFlux: 120, shortwave: 900 }), 300, 400)!;
    const fromSun = assessThermals(sunnyHour({ heatFlux: null, shortwave: 400 }), 300, 400)!;
    expect(fromModel.heatSource).toBe("model");
    expect(fromSun.heatSource).toBe("sunshine");
    expect(fromModel.wStar).toBeCloseTo(fromSun.wStar, 6);
    expect(fromModel.wStar).toBeGreaterThan(1.5);
  });

  it("expects a paraglider to climb at w* less about 1 m/s of sink", () => {
    const t = assessThermals(sunnyHour({ heatFlux: 120 }), 300, 400)!;
    expect(t.climbMs).toBeCloseTo(t.wStar - 1, 6);
  });

  it("finds no thermals when the model says the ground is cooling the air", () => {
    const t = assessThermals(sunnyHour({ heatFlux: -30, shortwave: 400 }), 300, 400)!;
    expect(t.wStar).toBe(0);
    expect(t.climbMs).toBe(0);
    expect(t.strength).toBe("none");
  });
});

describe("assessThermals on real forecasts", () => {
  const icon = parseForecast(loadFixture("sundvollen-icon.json"), "icon_seamless");
  const hour = (time: string) => icon.hours.find((h) => h.time === time)!;

  it("finds weak blue thermals to about 1,200 m at Sundvollen on Saturday afternoon", () => {
    const t = assessThermals(hour("2026-10-17T14:00"), icon.groundElevation, sundvollen.altDem)!;
    expect(t.cumulus).toBe(false);
    expect(t.ceilingM).toBeGreaterThan(1150);
    expect(t.ceilingM).toBeLessThan(1300);
    expect(t.strength).toBe("weak");
  });

  it("finds no usable thermals at Sundvollen on Sunday", () => {
    const t = assessThermals(hour("2026-10-18T13:00"), icon.groundElevation, sundvollen.altDem)!;
    expect(t.strength).toBe("none");
  });
});
