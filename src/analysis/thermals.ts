import type { HourSample, LevelSample } from "../types";

export const TRIGGER_K = 1;
export const DRY_LAPSE_K_PER_M = 0.0098;
export const CLOUD_BASE_M_PER_K = 125;
// Rough share of incoming sunshine that heats the air, for models without a heat flux.
export const SENSIBLE_HEAT_FRACTION = 0.3;
/** A paraglider's minimum sink, taken off w* for the climb to expect. */
export const GLIDER_SINK_MS = 1;
export const MIN_USABLE_ABOVE_LAUNCH_M = 150;
export const W_STAR_WEAK = 0.8;
export const W_STAR_MODERATE = 1.5;
export const W_STAR_STRONG = 2.5;
export const OD_CAPE_J_PER_KG = 300;

export type ThermalStrength = "none" | "weak" | "moderate" | "strong";
export type HeatSource = "model" | "sunshine";

export interface ThermalAssessment {
  topM: number;
  cloudBaseM: number | null;
  cumulus: boolean;
  ceilingM: number;
  aboveLaunchM: number;
  wStar: number;
  /** w* less a paraglider's sink: a rough climb rate in m/s. */
  climbMs: number;
  heatSource: HeatSource;
  strength: ThermalStrength;
  odRisk: boolean;
}

export function thermalTop(groundM: number, t2m: number, levels: LevelSample[]): number | null {
  const profile = levels
    .filter((l): l is LevelSample & { temperature: number } => l.temperature != null && l.heightM > groundM + 30)
    .sort((a, b) => a.heightM - b.heightM);
  if (profile.length === 0) return null;
  const excess = (z: number, envT: number) => t2m + TRIGGER_K - DRY_LAPSE_K_PER_M * (z - groundM) - envT;
  let prevZ = groundM;
  let prevD = excess(groundM, t2m);
  for (const l of profile) {
    const d = excess(l.heightM, l.temperature);
    if (d <= 0) return prevZ + ((l.heightM - prevZ) * prevD) / (prevD - d);
    prevZ = l.heightM;
    prevD = d;
  }
  return profile[profile.length - 1].heightM;
}

export function cloudBase(groundM: number, t2m: number, dewPoint: number): number {
  return groundM + CLOUD_BASE_M_PER_K * (t2m - dewPoint);
}

function convectiveVelocity(heatFlux: number, t2m: number, depthM: number): number {
  const buoyancy = (9.81 / (t2m + 273.15)) * (Math.max(0, heatFlux) / (1.2 * 1005));
  return Math.cbrt(buoyancy * Math.max(0, depthM));
}

function classify(wStar: number, aboveLaunchM: number): ThermalStrength {
  if (aboveLaunchM < MIN_USABLE_ABOVE_LAUNCH_M || wStar < W_STAR_WEAK) return "none";
  if (wStar < W_STAR_MODERATE) return "weak";
  return wStar < W_STAR_STRONG ? "moderate" : "strong";
}

export function assessThermals(hour: HourSample, groundM: number, launchM: number): ThermalAssessment | null {
  if (hour.temperature2m == null) return null;
  const topM = thermalTop(groundM, hour.temperature2m, hour.levels);
  if (topM == null) return null;
  const cloudBaseM = hour.dewPoint2m == null ? null : cloudBase(groundM, hour.temperature2m, hour.dewPoint2m);
  const cumulus = cloudBaseM != null && cloudBaseM < topM;
  const ceilingM = cumulus ? cloudBaseM : topM;
  const aboveLaunchM = ceilingM - launchM;
  const heatSource: HeatSource = hour.heatFlux != null ? "model" : "sunshine";
  const heatFlux = hour.heatFlux ?? SENSIBLE_HEAT_FRACTION * Math.max(0, hour.shortwave ?? 0);
  const wStar = convectiveVelocity(heatFlux, hour.temperature2m, ceilingM - groundM);
  return {
    topM,
    cloudBaseM,
    cumulus,
    ceilingM,
    aboveLaunchM,
    wStar,
    climbMs: Math.max(0, wStar - GLIDER_SINK_MS),
    heatSource,
    strength: classify(wStar, aboveLaunchM),
    odRisk: cumulus && (hour.cape ?? 0) >= OD_CAPE_J_PER_KG,
  };
}
