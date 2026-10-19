import { describe, expect, it } from "vitest";
import { limitingMeasures, rateHour, summarizeDay, type HourRating } from "../src/analysis/rating";
import { parseForecast } from "../src/forecast/parse";
import type { FlyState, HourSample, Measure, Reason } from "../src/types";
import { hydnefossen, level, loadFixture, sundvollen } from "./helpers";

const texts = (r: HourRating, level: string) => r.reasons.filter((x) => x.level === level).map((x) => x.text);

function calmHour(overrides: Partial<HourSample> = {}): HourSample {
  return {
    time: "2026-10-17T12:00",
    temperature2m: 8,
    dewPoint2m: 0,
    wind10m: { speed: 2, direction: 315 },
    gust10m: 3,
    precipitation: 0,
    cloudCover: 0,
    cloudCoverLow: 0,
    shortwave: 300,
    heatFlux: null,
    cape: 0,
    levels: [level(400, 2, 315, 7), level(900, 2, 315, 3), level(1500, 3, 315, -1)],
    ...overrides,
  };
}

describe("rateHour checks", () => {
  it("is no-go in rain", () => {
    const r = rateHour(sundvollen, calmHour({ precipitation: 0.8 }), 300);
    expect(r.state).toBe("nogo");
    expect(texts(r, "nogo")[0]).toMatch(/Rain/);
    expect(limitingMeasures(r)).toEqual(["rain"]);
  });

  it("is no-go when the launch wind is too strong", () => {
    const r = rateHour(sundvollen, calmHour({ levels: [level(300, 9, 315), level(900, 10, 315)] }), 300);
    expect(r.state).toBe("nogo");
  });

  it("flags strong gusts as no-go and a high gust factor as marginal", () => {
    expect(rateHour(sundvollen, calmHour({ gust10m: 11 }), 300).state).toBe("nogo");
    const gusty = rateHour(sundvollen, calmHour({ wind10m: { speed: 2.4, direction: 315 }, gust10m: 6.5 }), 300);
    expect(gusty.state).toBe("marginal");
    expect(texts(gusty, "warn")[0]).toMatch(/Gusty/);
    expect(limitingMeasures(gusty)).toEqual(["gusts"]);
  });

  it("flags a light tailwind as marginal", () => {
    const r = rateHour(sundvollen, calmHour({ levels: [level(300, 2, 135), level(900, 2, 135)] }), 300);
    expect(r.state).toBe("marginal");
    expect(texts(r, "warn").join()).toMatch(/tailwind/);
  });

  it("gives the thermals' expected climb and where their strength comes from", () => {
    const fromModel = rateHour(sundvollen, calmHour({ heatFlux: 300 }), 300);
    expect(texts(fromModel, "good").join()).toMatch(/Moderate thermals/);
    expect(texts(fromModel, "info").join()).toMatch(/Climbs around \d\.\d m\/s \(w\* \d\.\d m\/s, from the model's heat flux\)/);
    const fromSun = rateHour(sundvollen, calmHour({ shortwave: 1000 }), 300);
    expect(texts(fromSun, "info").join()).toMatch(/estimated from sunshine/);
    const barely = rateHour(sundvollen, calmHour({ heatFlux: 60 }), 300);
    expect(texts(barely, "info").join()).toMatch(/Hardly any climb: w\* \d\.\d m\/s is about a glider's sink/);
  });

  it("uses the near-ground wind when a model has no pressure levels", () => {
    const r = rateHour(sundvollen, calmHour({ levels: [] }), 300);
    expect(r.launchWindSource).toBe("near-ground");
    expect(r.thermals).toBeNull();
  });
});

describe("rateHour on real forecasts", () => {
  const sundvollenIcon = parseForecast(loadFixture("sundvollen-icon.json"), "icon_seamless");
  const rateSundvollen = (time: string) =>
    rateHour(sundvollen, sundvollenIcon.hours.find((h) => h.time === time)!, sundvollenIcon.groundElevation);

  it("Sundvollen Saturday morning: too much wind just above the ridge", () => {
    const r = rateSundvollen("2026-10-17T09:00");
    expect(r.state).toBe("nogo");
    expect(texts(r, "nogo").join()).toMatch(/above launch/);
  });

  it("Sundvollen Saturday afternoon: north wind onto the ridge, soarable", () => {
    const r = rateSundvollen("2026-10-17T14:00");
    expect(r.direction?.fit).toBe("good");
    expect(texts(r, "good").join()).toMatch(/Ridge lift/);
    expect(r.state).toBe("soar");
  });

  it("Sundvollen Sunday: near calm, flyable but no lift", () => {
    expect(rateSundvollen("2026-10-18T13:00").state).toBe("fly");
  });

  it("Hydnefossen Saturday: north-westerly from behind the launch", () => {
    const icon = parseForecast(loadFixture("hydnefossen-icon.json"), "icon_seamless");
    const r = rateHour(hydnefossen, icon.hours.find((h) => h.time === "2026-10-17T14:00")!, icon.groundElevation);
    expect(r.state).toBe("nogo");
    expect(r.direction?.fit).toBe("behind");

    const meps = parseForecast(loadFixture("hydnefossen-meps.json"), "metno_nordic");
    const m = rateHour(hydnefossen, meps.hours.find((h) => h.time === "2026-10-17T14:00")!, meps.groundElevation);
    expect(m.state).toBe("nogo");
    expect(m.launchWindSource).toBe("near-ground");
    expect(texts(m, "nogo").join()).toMatch(/behind/);
    expect(limitingMeasures(m)).toEqual(["behind", "gusts"]);
  });

  it("names nothing as limiting when an hour is flyable", () => {
    expect(limitingMeasures(rateSundvollen("2026-10-18T13:00"))).toEqual([]);
  });
});

describe("summarizeDay", () => {
  const time = (h: number) => `2026-10-17T${String(h).padStart(2, "0")}:00`;
  const hours = (states: FlyState[], startHour = 9) =>
    states.map((state, i) => ({ time: time(startHour + i), state, reasons: [] as Reason[] }) as HourRating);
  const blocked = (state: FlyState, measures: Measure[], h: number) =>
    ({
      time: time(h),
      state,
      reasons: measures.map((measure) => ({ level: state === "nogo" ? "nogo" : "warn", text: measure, measure })),
    }) as HourRating;

  it("counts what blocks a day that is not flyable", () => {
    const s = summarizeDay(
      [blocked("nogo", ["behind", "gusts"], 10), blocked("nogo", ["behind"], 11), blocked("marginal", ["gusts"], 12), blocked("nogo", ["behind"], 13)],
      null,
      null,
    );
    expect(s.state).toBe("nogo");
    expect(s.blockers).toEqual([
      { measure: "behind", hours: 3 },
      { measure: "gusts", hours: 2 },
    ]);
  });

  it("lists no blockers on a flyable day", () => {
    expect(summarizeDay(hours(["fly", "fly", "nogo"]), null, null).blockers).toEqual([]);
  });

  it("reports the best state held for at least two hours in a row", () => {
    const s = summarizeDay(hours(["nogo", "marginal", "soar", "soar", "fly", "nogo"]), null, null);
    expect(s).toEqual({ state: "soar", window: { start: "11:00", end: "13:00" }, blockers: [] });
  });

  it("does not count isolated good hours", () => {
    expect(summarizeDay(hours(["soar", "fly", "soar"]), null, null).state).toBe("fly");
  });

  it("only counts daylight hours", () => {
    const s = summarizeDay(hours(["soar", "soar", "nogo", "nogo"], 6), "2026-10-17T08:05", "2026-10-17T18:00");
    expect(s.state).toBe("nogo");
    expect(s.window).toBeNull();
  });
});

describe("missing forecasts", () => {
  it("marks hours without any wind data as no data and leaves them out of the day summary", () => {
    const empty = calmHour({ levels: [], wind10m: null, gust10m: null });
    expect(rateHour(sundvollen, empty, 300).state).toBe("nodata");
    const s = summarizeDay(
      [
        { time: "2026-10-17T10:00", state: "nodata", reasons: [] },
        { time: "2026-10-17T11:00", state: "nodata", reasons: [] },
      ],
      null,
      null,
    );
    expect(s).toEqual({ state: null, window: null, blockers: [] });
  });
});
