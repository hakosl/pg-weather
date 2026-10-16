export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altPe: number | null;
  altDem: number;
  aspect: number;
  dropM: number;
  riseM: number;
  aspectReliable: boolean;
  terrainSource: "kartverket-dtm1" | "copernicus-90m";
  /** Paragliding Earth ratings per sector N, NE, E, SE, S, SW, W, NW (0 bad, 1 marginal, 2 good); null when unrated. */
  ratings: number[] | null;
  sourcesDisagree: boolean;
  altitudeMismatch: boolean;
  soaring: boolean;
  thermals: boolean;
  landing: { lat: number; lon: number } | null;
  link: string;
}

export type ModelId = "ecmwf_ifs025" | "icon_seamless" | "gfs_seamless" | "metno_nordic";

export interface Wind {
  speed: number;
  direction: number;
}

export interface LevelSample {
  pressure: number;
  heightM: number;
  wind: Wind | null;
  temperature: number | null;
}

export interface HourSample {
  time: string;
  temperature2m: number | null;
  dewPoint2m: number | null;
  wind10m: Wind | null;
  gust10m: number | null;
  precipitation: number | null;
  cloudCover: number | null;
  cloudCoverLow: number | null;
  shortwave: number | null;
  cape: number | null;
  levels: LevelSample[];
}

export interface ModelForecast {
  model: ModelId;
  groundElevation: number;
  /** Sunrise and sunset per local day, keyed by YYYY-MM-DD. */
  daylight: Record<string, { sunrise: string; sunset: string }>;
  hours: HourSample[];
  /** When this forecast was fetched (ms since epoch), set by the cache loader. */
  fetchedAt?: number;
}

export type FlyState = "nodata" | "nogo" | "marginal" | "fly" | "soar";

export type ReasonLevel = "nogo" | "warn" | "good" | "info";

/** The measure behind a warning or no-go, so the UI can say what stops a site from being flyable. */
export type Measure =
  | "rain"
  | "launchWind"
  | "windAbove"
  | "gusts"
  | "behind"
  | "tailwind"
  | "crosswind"
  | "direction"
  | "unknownDirection"
  | "lowCloud"
  | "overdevelopment";

export interface Reason {
  level: ReasonLevel;
  text: string;
  measure?: Measure;
}
