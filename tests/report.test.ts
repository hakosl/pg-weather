import { describe, expect, it, vi } from "vitest";
import type { HourRating } from "../src/analysis/rating";
import type { SiteDay } from "../src/forecast/overview";
import { parseForecast } from "../src/forecast/parse";
import { alertFor, buildReports, formatReport, isSoarable, osloDays, sendAlert, type SiteReport } from "../src/report";
import type { FlyState, ModelId } from "../src/types";
import { loadFixture, sundvollen } from "./helpers";

function siteDay(state: FlyState | null): SiteDay {
  const hours = ["11", "12", "13"].map(
    (h, i) => ({ time: `2026-10-21T${h}:00`, state: state ?? "nodata", launchWind: { speed: 2 + i, direction: 315 } }) as HourRating,
  );
  const window = state === "fly" || state === "soar" ? { start: "11:00", end: "14:00" } : null;
  const blockers = state === "nogo" ? [{ measure: "rain" as const, hours: 5 }] : [];
  return { hours, summary: { state, window, blockers } };
}

const report = (day: string, ...models: [ModelId, FlyState | null][]): SiteReport => ({
  site: sundvollen,
  day,
  models: models.map(([model, state]) => ({ model, day: siteDay(state) })),
});

const soarableWednesday = report("2026-10-21", ["ecmwf_ifs025", "soar"], ["icon_seamless", "soar"], ["gfs_seamless", "nogo"], ["metno_nordic", null]);
const flyableThursday = report("2026-10-22", ["ecmwf_ifs025", "fly"], ["icon_seamless", "soar"]);

describe("osloDays", () => {
  it("starts from today's date in Oslo, not in UTC", () => {
    // 22:30 UTC on 24 Oct is already 00:30 on the 25th in Oslo.
    expect(osloDays(Date.UTC(2026, 9, 24, 22, 30), 3)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27"]);
    expect(osloDays(Date.UTC(2026, 11, 30, 12), 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

describe("isSoarable", () => {
  it("needs at least two models to rate the day soarable, which means two hours of it in a row", () => {
    expect(isSoarable(soarableWednesday)).toBe(true);
    expect(isSoarable(flyableThursday)).toBe(false);
    const twoHours = parseForecast(loadFixture("sundvollen-icon.json"), "icon_seamless");
    const [saturday] = buildReports([sundvollen], ["2026-10-17"], [
      { model: "icon_seamless", forecasts: new Map([["sundvollen", twoHours]]) },
      { model: "gfs_seamless", forecasts: new Map([["sundvollen", { ...twoHours, model: "gfs_seamless" }]]) },
    ]);
    expect(saturday.models[0].day.summary).toMatchObject({ state: "soar", window: { start: "14:00", end: "16:00" } });
    expect(isSoarable(saturday)).toBe(true);
  });
});

describe("formatReport", () => {
  it("leads with the soarable days, then each model's day", () => {
    expect(formatReport([soarableWednesday], []).split("\n")).toEqual([
      "SOARABLE: Sundvollen Wed 21 Oct",
      "",
      "Sundvollen, Wed 21 Oct: 2 of 4 models soarable",
      "  ECMWF  soarable 11:00–14:00, launch wind 2.0–4.0 m/s from NW",
      "  ICON   soarable 11:00–14:00, launch wind 2.0–4.0 m/s from NW",
      "  GFS    no-go: rain (5 h)",
      "  MEPS   no data",
    ]);
  });

  it("says when nothing is soarable, and names the models that failed", () => {
    const text = formatReport([flyableThursday], [{ model: "gfs_seamless", error: "Open-Meteo: HTTP 502" }]);
    expect(text.split("\n").slice(0, 2)).toEqual(["NOTHING SOARABLE", "GFS failed: Open-Meteo: HTTP 502"]);
  });
});

describe("alertFor", () => {
  it("covers only the soarable days", () => {
    const alert = alertFor([soarableWednesday, flyableThursday])!;
    expect(alert.title).toBe("Soarable: Sundvollen Wed 21 Oct");
    expect(alert.message.split("\n")[0]).toBe("Sundvollen, Wed 21 Oct: 2 of 4 models soarable");
    expect(alert.message).not.toMatch(/Thu 22 Oct/);
  });

  it("is null when nothing is soarable", () => {
    expect(alertFor([flyableThursday])).toBeNull();
  });
});

describe("sendAlert", () => {
  const alert = { title: "Soarable: Sundvollen Wed 21 Oct", message: "Sundvollen, Wed 21 Oct: 2 of 4 models soarable" };

  it("publishes to the ntfy topic as JSON, opening the app on tap", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }) as Response);
    await sendAlert("pg-topic", alert, fetchFn);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ topic: "pg-topic", ...alert, click: "https://hakosl.github.io/pg-weather/" });
  });

  it("fails loudly when ntfy refuses the message", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429, text: async () => "limit reached" }) as Response);
    await expect(sendAlert("pg-topic", alert, fetchFn)).rejects.toThrow("ntfy: HTTP 429 limit reached");
  });
});

describe("buildReports", () => {
  it("rates each site's days with every model that answered", () => {
    const icon = parseForecast(loadFixture("sundvollen-icon.json"), "icon_seamless");
    const reports = buildReports([sundvollen], ["2026-10-17", "2026-10-18"], [
      { model: "icon_seamless", forecasts: new Map([["sundvollen", icon]]) },
      { model: "gfs_seamless", error: "down" },
    ]);
    expect(reports.map((r) => [r.day, r.models.map((m) => [m.model, m.day.summary.state])])).toEqual([
      ["2026-10-17", [["icon_seamless", "soar"]]],
      ["2026-10-18", [["icon_seamless", "fly"]]],
    ]);
  });
});
