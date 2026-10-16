import type { LevelSample, Site, Wind } from "../types";

export type DirectionFit = "good" | "marginal" | "cross" | "behind" | "unknown";

export interface DirectionAssessment {
  fit: DirectionFit;
  facing: number | null;
  source: "holfuy" | "ratings" | "terrain" | "none";
}

type Zone = [number, number];

export const TERRAIN_GOOD_DEG = 30;
export const TERRAIN_MARGINAL_DEG = 55;
// Past 90° the wind blows off the slope; 10° margin for terrain and model error.
export const BEHIND_DEG = 100;

const RAD = Math.PI / 180;

export const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

export function angleDiff(a: number, b: number): number {
  return Math.abs(normalizeDeg(a - b + 180) - 180);
}

// Meteorological convention: direction is where the wind comes from.
function toUV({ speed, direction }: Wind): [number, number] {
  return [-speed * Math.sin(direction * RAD), -speed * Math.cos(direction * RAD)];
}

function fromUV(u: number, v: number): Wind {
  return { speed: Math.hypot(u, v), direction: normalizeDeg(Math.atan2(-u, -v) / RAD) };
}

function withWind(levels: LevelSample[]): (LevelSample & { wind: Wind })[] {
  return levels
    .filter((l): l is LevelSample & { wind: Wind } => l.wind != null)
    .sort((a, b) => a.heightM - b.heightM);
}

export function windAt(levels: LevelSample[], heightM: number): Wind | null {
  const profile = withWind(levels);
  if (profile.length === 0) return null;
  if (heightM <= profile[0].heightM) return profile[0].wind;
  const last = profile[profile.length - 1];
  if (heightM >= last.heightM) return last.wind;
  const upper = profile.findIndex((l) => l.heightM >= heightM);
  const lo = profile[upper - 1];
  const hi = profile[upper];
  const t = (heightM - lo.heightM) / (hi.heightM - lo.heightM);
  const [u1, v1] = toUV(lo.wind);
  const [u2, v2] = toUV(hi.wind);
  return fromUV(u1 + t * (u2 - u1), v1 + t * (v2 - v1));
}

export function maxWindBetween(
  levels: LevelSample[],
  fromM: number,
  toM: number,
): { wind: Wind; heightM: number } | null {
  const heights = [fromM, ...withWind(levels).map((l) => l.heightM).filter((h) => h > fromM && h < toM), toM];
  let best: { wind: Wind; heightM: number } | null = null;
  for (const h of heights) {
    const wind = windAt(levels, h);
    if (wind && (!best || wind.speed > best.wind.speed)) best = { wind, heightM: h };
  }
  return best;
}

function ratedFacing(ratings: number[]): number | null {
  let x = 0;
  let y = 0;
  ratings.forEach((weight, i) => {
    x += weight * Math.sin(i * 45 * RAD);
    y += weight * Math.cos(i * 45 * RAD);
  });
  return Math.hypot(x, y) < 1e-6 ? null : normalizeDeg(Math.atan2(x, y) / RAD);
}

const isFullCircle = ([from, to]: Zone) => to - from >= 360;

export function inZone(direction: number, zone: Zone): boolean {
  return isFullCircle(zone) || normalizeDeg(direction - zone[0]) <= normalizeDeg(zone[1] - zone[0]);
}

function zoneCentre(zone: Zone | null): number | null {
  if (!zone || isFullCircle(zone)) return null;
  return normalizeDeg(zone[0] + normalizeDeg(zone[1] - zone[0]) / 2);
}

/** Which way the slope faces, for ridge lift: terrain when it is clear, else the middle of the flyable directions. */
export function siteFacing(site: Site): number | null {
  if (site.aspectReliable) return site.aspect;
  const fromZones = zoneCentre(site.holfuy?.green ?? null) ?? zoneCentre(site.holfuy?.yellow ?? null);
  if (fromZones != null) return fromZones;
  return site.ratings ? ratedFacing(site.ratings) : null;
}

function offZone(windDirection: number, facing: number | null): DirectionFit {
  return facing != null && angleDiff(windDirection, facing) > BEHIND_DEG ? "behind" : "cross";
}

export function directionFit(site: Site, windDirection: number): DirectionAssessment {
  const facing = siteFacing(site);
  const { green, yellow } = site.holfuy ?? { green: null, yellow: null };
  if (green || yellow) {
    if (green && inZone(windDirection, green)) return { fit: "good", facing, source: "holfuy" };
    if (yellow && inZone(windDirection, yellow)) return { fit: "marginal", facing, source: "holfuy" };
    return { fit: offZone(windDirection, facing), facing, source: "holfuy" };
  }
  if (site.ratings) {
    const rating = site.ratings[Math.round(normalizeDeg(windDirection) / 45) % 8];
    if (rating >= 2) return { fit: "good", facing, source: "ratings" };
    if (rating === 1) return { fit: "marginal", facing, source: "ratings" };
    return { fit: offZone(windDirection, facing), facing, source: "ratings" };
  }
  if (facing == null) return { fit: "unknown", facing: null, source: "none" };
  const diff = angleDiff(windDirection, facing);
  const fit: DirectionFit =
    diff <= TERRAIN_GOOD_DEG ? "good" : diff <= TERRAIN_MARGINAL_DEG ? "marginal" : diff > BEHIND_DEG ? "behind" : "cross";
  return { fit, facing, source: "terrain" };
}

export function ontoSlope(wind: Wind, facing: number): number {
  return wind.speed * Math.cos(angleDiff(wind.direction, facing) * RAD);
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compass(deg: number): string {
  return COMPASS[Math.round(normalizeDeg(deg) / 22.5) % 16];
}
