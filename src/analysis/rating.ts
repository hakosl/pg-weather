import type { FlyState, HourSample, Measure, Reason, Site, Wind } from "../types";
import { assessThermals, type ThermalAssessment } from "./thermals";
import { compass, directionFit, maxWindBetween, ontoSlope, windAt, type DirectionAssessment } from "./wind";

export const LIMITS = {
  nilWind: 1.5,
  launchStrong: 6,
  launchTooStrong: 8,
  aboveBandM: 500,
  aboveStrong: 8,
  aboveTooStrong: 10,
  gustStrong: 8,
  gustTooStrong: 10,
  gustFactorMinGust: 6,
  gustFactor: 2.5,
  crossWarn: 3,
  crossTooStrong: 6,
  tailwindNoGo: 1,
  ridgeMin: 3,
  ridgeMax: 7,
  ridgeMinDropM: 100,
  rainNoGo: 0.3,
  rainWarn: 0.1,
  lowCloudPct: 80,
  thermalMinAboveLaunchM: 300,
} as const;

export interface HourRating {
  time: string;
  state: FlyState;
  sample: HourSample;
  reasons: Reason[];
  launchWind: Wind | null;
  launchWindSource: "profile" | "near-ground" | null;
  above: { wind: Wind; heightM: number } | null;
  direction: DirectionAssessment | null;
  ontoSlopeMs: number | null;
  thermals: ThermalAssessment | null;
}

const ms = (v: number) => `${v.toFixed(1)} m/s`;
const m = (v: number) => `${Math.round(v).toLocaleString("en-GB")} m`;
const windText = (w: Wind) => `${ms(w.speed)} from ${compass(w.direction)}`;

function rainReasons(hour: HourSample): Reason[] {
  const p = hour.precipitation ?? 0;
  if (p >= LIMITS.rainNoGo) return [{ level: "nogo", text: `Rain, ${p.toFixed(1)} mm/h`, measure: "rain" }];
  if (p >= LIMITS.rainWarn) return [{ level: "warn", text: `Showers possible, ${p.toFixed(1)} mm/h`, measure: "rain" }];
  return [];
}

function launchWindReasons(wind: Wind, source: HourRating["launchWindSource"]): Reason[] {
  const label = source === "near-ground" ? "Near-ground wind" : "Launch wind";
  if (wind.speed >= LIMITS.launchTooStrong)
    return [{ level: "nogo", text: `${label} ${windText(wind)}, too strong`, measure: "launchWind" }];
  if (wind.speed >= LIMITS.launchStrong)
    return [{ level: "warn", text: `Strong ${label.toLowerCase()}, ${windText(wind)}`, measure: "launchWind" }];
  if (wind.speed < LIMITS.nilWind) return [{ level: "info", text: `Nil wind at launch (${ms(wind.speed)}): forward launch` }];
  return [{ level: "info", text: `${label} ${windText(wind)}` }];
}

function aboveReasons(above: HourRating["above"], launchM: number): Reason[] {
  if (!above || above.heightM <= launchM) return [];
  const where = `at ${m(above.heightM)} (${m(above.heightM - launchM)} above launch)`;
  if (above.wind.speed >= LIMITS.aboveTooStrong)
    return [{ level: "nogo", text: `${windText(above.wind)} ${where}: risk of being blown back`, measure: "windAbove" }];
  if (above.wind.speed >= LIMITS.aboveStrong)
    return [{ level: "warn", text: `${windText(above.wind)} ${where}: strong wind just above the ridge`, measure: "windAbove" }];
  return [];
}

function gustReasons(hour: HourSample): Reason[] {
  const gust = hour.gust10m;
  if (gust == null) return [];
  if (gust >= LIMITS.gustTooStrong) return [{ level: "nogo", text: `Gusts to ${ms(gust)}`, measure: "gusts" }];
  const mean = hour.wind10m?.speed ?? 0;
  const factor = mean > 0 ? gust / mean : Infinity;
  if (gust >= LIMITS.gustStrong || (gust >= LIMITS.gustFactorMinGust && factor >= LIMITS.gustFactor)) {
    const ratio = Number.isFinite(factor) ? ` (${factor.toFixed(1)}×)` : "";
    return [{ level: "warn", text: `Gusty: ${ms(mean)} gusting ${ms(gust)}${ratio}`, measure: "gusts" }];
  }
  return [];
}

function directionReasons(wind: Wind, fit: DirectionAssessment, onto: number | null): Reason[] {
  // Checked before the nil-wind exemption: even a near-calm tailwind down the slope stops a launch.
  const tailwind = fit.fit === "behind" && onto != null ? -onto : 0;
  if (tailwind > LIMITS.tailwindNoGo)
    return [{ level: "nogo", text: `Wind from behind the launch, ${ms(tailwind)} down the slope (${windText(wind)}): lee and rotor`, measure: "behind" }];
  const dir = compass(wind.direction);
  // Any tailwind makes a launch hard, so unlike the other directions it is flagged in nil wind too.
  if (fit.fit === "behind") return [{ level: "warn", text: `Light tailwind from ${dir}: hard to launch`, measure: "tailwind" }];
  if (wind.speed < LIMITS.nilWind) return [];
  switch (fit.fit) {
    case "good":
      return [{ level: "good", text: `${dir} wind suits this launch` }];
    case "marginal":
      return [{ level: "warn", text: `${dir} wind is marginal for this launch`, measure: "direction" }];
    case "cross":
      if (wind.speed >= LIMITS.crossTooStrong)
        return [{ level: "nogo", text: `Strong crosswind, ${windText(wind)}`, measure: "crosswind" }];
      return wind.speed >= LIMITS.crossWarn ? [{ level: "warn", text: `Crosswind from ${dir}`, measure: "crosswind" }] : [];
    case "unknown":
      return wind.speed >= LIMITS.crossWarn
        ? [{ level: "warn", text: "Launch direction unknown: check locally which winds work here", measure: "unknownDirection" }]
        : [];
  }
}

function cloudReasons(hour: HourSample): Reason[] {
  const low = hour.cloudCoverLow ?? 0;
  return low >= LIMITS.lowCloudPct
    ? [{ level: "warn", text: `Low cloud or fog likely (${Math.round(low)}% low cloud)`, measure: "lowCloud" }]
    : [];
}

function ridgeReasons(site: Site, onto: number | null, fit: DirectionAssessment): Reason[] {
  if (onto == null || (fit.fit !== "good" && fit.fit !== "marginal")) return [];
  if (site.dropM < LIMITS.ridgeMinDropM) return [];
  if (onto >= LIMITS.ridgeMin && onto <= LIMITS.ridgeMax)
    return [{ level: "good", text: `Ridge lift: ${ms(onto)} onto the slope` }];
  if (onto >= LIMITS.nilWind && onto < LIMITS.ridgeMin)
    return [{ level: "info", text: `Too light for ridge soaring (${ms(onto)} onto the slope)` }];
  return [];
}

// Below this, "climbs around 0.0 m/s" reads as a forecast; say there is hardly any climb instead.
const MIN_CLIMB_MS = 0.1;

function thermalReasons(t: ThermalAssessment | null, levels: HourSample["levels"]): Reason[] {
  if (!t || t.strength === "none") return [];
  const reasons: Reason[] = [];
  const where = `to ${m(t.ceilingM)} (${m(t.aboveLaunchM)} above launch)`;
  const usable = t.strength !== "weak" && t.aboveLaunchM >= LIMITS.thermalMinAboveLaunchM;
  reasons.push(
    usable
      ? { level: "good", text: `${t.strength === "strong" ? "Strong" : "Moderate"} thermals ${where}` }
      : { level: "info", text: `Weak thermals ${where}` },
  );
  const source = t.heatSource === "model" ? "from the model's heat flux" : "estimated from sunshine";
  const climb =
    t.climbMs < MIN_CLIMB_MS
      ? `Hardly any climb: w* ${ms(t.wStar)} is about a glider's sink (${source})`
      : `Climbs around ${ms(t.climbMs)} (w* ${ms(t.wStar)}, ${source})`;
  reasons.push({ level: "info", text: climb });
  reasons.push({ level: "info", text: t.cumulus ? `Cumulus base around ${m(t.cloudBaseM!)}` : "Blue thermals, no cumulus" });
  const topWind = windAt(levels, t.ceilingM);
  if (topWind && topWind.speed >= LIMITS.aboveStrong)
    reasons.push({ level: "info", text: `${windText(topWind)} at the thermal top: thermals will be broken and drift` });
  if (t.odRisk) reasons.push({ level: "warn", text: "Overdevelopment risk: unstable air with cumulus", measure: "overdevelopment" });
  return reasons;
}

function stateOf(reasons: Reason[], hasLift: boolean): FlyState {
  if (reasons.some((r) => r.level === "nogo")) return "nogo";
  if (reasons.some((r) => r.level === "warn")) return "marginal";
  return hasLift ? "soar" : "fly";
}

export interface Daylight {
  sunrise: string;
  sunset: string;
}

function daylightReasons(time: string, light: Daylight | undefined): Reason[] {
  if (!light) return [];
  const [start, rise, set] = [clock(time), clock(light.sunrise), clock(light.sunset)];
  const [riseText, setText] = [light.sunrise.slice(11, 16), light.sunset.slice(11, 16)];
  if (start + 1 <= rise || start >= set) return [{ level: "nogo", text: `Dark: daylight ${riseText}–${setText}`, measure: "dark" }];
  if (start < rise) return [{ level: "warn", text: `Sunrise at ${riseText}`, measure: "dark" }];
  if (start + 1 > set) return [{ level: "warn", text: `Sunset at ${setText}`, measure: "dark" }];
  return [];
}

export function rateHour(site: Site, hour: HourSample, groundM: number, light?: Daylight): HourRating {
  const launchM = site.altDem;
  const profileWind = windAt(hour.levels, launchM);
  const launchWind = profileWind ?? hour.wind10m;
  const launchWindSource = profileWind ? "profile" : hour.wind10m ? "near-ground" : null;
  if (!launchWind) {
    const reasons: Reason[] = [{ level: "info", text: "No forecast from this model for this hour" }];
    return { time: hour.time, state: "nodata", sample: hour, reasons, launchWind: null, launchWindSource: null, above: null, direction: null, ontoSlopeMs: null, thermals: null };
  }
  const above = profileWind ? maxWindBetween(hour.levels, launchM, launchM + LIMITS.aboveBandM) : null;
  const direction = directionFit(site, launchWind.direction);
  const ontoSlopeMs = direction.facing != null ? ontoSlope(launchWind, direction.facing) : null;
  const thermals = assessThermals(hour, groundM, launchM);

  const lift = [...ridgeReasons(site, ontoSlopeMs, direction), ...thermalReasons(thermals, hour.levels)];
  const reasons = [
    ...daylightReasons(hour.time, light),
    ...rainReasons(hour),
    ...launchWindReasons(launchWind, launchWindSource),
    ...directionReasons(launchWind, direction, ontoSlopeMs),
    ...aboveReasons(above, launchM),
    ...gustReasons(hour),
    ...cloudReasons(hour),
    ...lift,
  ];
  const hasLift = lift.some((r) => r.level === "good");
  return { time: hour.time, state: stateOf(reasons, hasLift), sample: hour, reasons, launchWind, launchWindSource, above, direction, ontoSlopeMs, thermals };
}

/** The measures that set this hour's state: its no-go reasons, or its warnings when marginal. */
export function limitingMeasures(r: Pick<HourRating, "state" | "reasons">): Measure[] {
  if (r.state !== "nogo" && r.state !== "marginal") return [];
  const level = r.state === "nogo" ? "nogo" : "warn";
  return [...new Set(r.reasons.flatMap((x) => (x.level === level && x.measure ? [x.measure] : [])))];
}

export interface DaySummary {
  state: FlyState | null;
  window: { start: string; end: string } | null;
  /** When the day is not flyable: how many daylight hours each measure blocks, most first. */
  blockers: { measure: Measure; hours: number }[];
}

const RANK: Record<FlyState, number> = { nodata: -1, nogo: 0, marginal: 1, fly: 2, soar: 3 };
const STATES: FlyState[] = ["nogo", "marginal", "fly", "soar"];
const DEFAULT_DAY_HOURS = [8, 20];
const MIN_WINDOW_HOURS = 2;

const clock = (iso: string) => {
  const [h, min] = iso.slice(11, 16).split(":").map(Number);
  return h + min / 60;
};
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

type RatedHour = Pick<HourRating, "time" | "state" | "reasons">;

function countBlockers(hours: RatedHour[]): DaySummary["blockers"] {
  const counts = new Map<Measure, number>();
  for (const h of hours) for (const m of limitingMeasures(h)) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([measure, hours]) => ({ measure, hours })).sort((a, b) => b.hours - a.hours);
}

export function summarizeDay(ratings: RatedHour[], sunrise: string | null, sunset: string | null): DaySummary {
  const [from, to] = sunrise && sunset ? [clock(sunrise), clock(sunset)] : DEFAULT_DAY_HOURS;
  const daylight = ratings.filter((r) => r.state !== "nodata" && clock(r.time) >= from && clock(r.time) + 1 <= to);
  if (daylight.length === 0) return { state: null, window: null, blockers: [] };
  for (let rank = RANK.soar; rank >= RANK.marginal; rank--) {
    const run = longestRun(daylight.map((r) => RANK[r.state] >= rank));
    if (run && run.length >= MIN_WINDOW_HOURS) {
      const start = clock(daylight[run.start].time);
      const window = { start: hourLabel(start), end: hourLabel(start + run.length) };
      return { state: STATES[rank], window, blockers: rank >= RANK.fly ? [] : countBlockers(daylight) };
    }
  }
  return { state: "nogo", window: null, blockers: countBlockers(daylight) };
}

function longestRun(flags: boolean[]): { start: number; length: number } | null {
  let best: { start: number; length: number } | null = null;
  let start = -1;
  flags.forEach((ok, i) => {
    if (!ok) {
      start = -1;
      return;
    }
    if (start < 0) start = i;
    const length = i - start + 1;
    if (!best || length > best.length) best = { start, length };
  });
  return best;
}
