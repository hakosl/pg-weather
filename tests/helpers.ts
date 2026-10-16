import { readFileSync } from "node:fs";
import type { LevelSample, Site } from "../src/types";

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const baseSite: Site = {
  id: "0",
  name: "Test",
  lat: 60,
  lon: 10,
  altPe: null,
  altDem: 500,
  aspect: 0,
  dropM: 300,
  riseM: 100,
  aspectReliable: true,
  terrainSource: "kartverket-dtm1",
  ratings: null,
  holfuy: null,
  sourcesDisagree: false,
  altitudeMismatch: false,
  soaring: false,
  thermals: false,
  landing: null,
  link: "",
};

export function makeSite(overrides: Partial<Site>): Site {
  return { ...baseSite, ...overrides };
}

// Values from build-sites at the Paragliding Earth coordinates.
export const sundvollen = makeSite({
  id: "sundvollen",
  name: "Sundvollen",
  lat: 60.0533,
  lon: 10.322,
  altPe: 420,
  altDem: 378,
  aspect: 319,
  dropM: 251,
  riseM: 86,
  ratings: [2, 1, 0, 0, 0, 1, 2, 2],
  holfuy: { id: 395, name: "OPK Sundvollen", distanceM: 97, green: [240, 0], yellow: [220, 20] },
  soaring: true,
});

// Sundvollen as Paragliding Earth alone rates it, for testing that source on its own.
export const sundvollenRatingsOnly = makeSite({ ...sundvollen, holfuy: null });

export const hydnefossen = makeSite({
  id: "hydnefossen",
  name: "Hemsedal- Hydnefossen",
  lat: 60.8014,
  lon: 8.62806,
  altPe: 800,
  altDem: 1056,
  aspect: 67,
  dropM: 271,
  riseM: 253,
  holfuy: { id: 133, name: "OPK Hydnefossen", distanceM: 602, green: [30, 112], yellow: [20, 160] },
  altitudeMismatch: true,
});

export function level(heightM: number, speed: number | null, direction: number, temperature: number | null = null): LevelSample {
  return {
    pressure: 0,
    heightM,
    wind: speed == null ? null : { speed, direction },
    temperature,
  };
}
