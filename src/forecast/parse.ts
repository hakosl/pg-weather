import type { HourSample, LevelSample, ModelForecast, ModelId, Wind } from "../types";

export const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700] as const;

// Standard-atmosphere heights, used when a model returns wind for a level but no geopotential height.
const STANDARD_HEIGHT_M: Record<number, number> = {
  1000: 110,
  975: 320,
  950: 540,
  925: 760,
  900: 990,
  850: 1460,
  800: 1950,
  700: 3010,
};

export const SURFACE_VARIABLES = [
  "temperature_2m",
  "dew_point_2m",
  "precipitation",
  "cloud_cover",
  "cloud_cover_low",
  "shortwave_radiation",
  "cape",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
];

const LEVEL_VARIABLES = ["wind_speed", "wind_direction", "temperature", "geopotential_height"];

export const HOURLY_VARIABLES = [
  ...SURFACE_VARIABLES,
  ...PRESSURE_LEVELS.flatMap((p) => LEVEL_VARIABLES.map((v) => `${v}_${p}hPa`)),
];

type Column = (number | null)[];

interface RawResponse {
  error?: boolean;
  reason?: string;
  elevation?: number;
  hourly?: Record<string, unknown>;
  daily?: Record<string, unknown>;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function makeWind(speed: number | null, direction: number | null): Wind | null {
  return speed == null || direction == null ? null : { speed, direction };
}

export function parseForecast(raw: unknown, model: ModelId): ModelForecast {
  const res = (raw ?? {}) as RawResponse;
  if (res.error) throw new Error(`Open-Meteo: ${res.reason ?? "request failed"}`);
  const hourly = res.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times)) throw new Error("Open-Meteo returned no hourly data");

  const col = (name: string): Column => {
    const values = hourly[name];
    return Array.isArray(values) ? values.map(asNumber) : [];
  };
  const daily = (name: string): unknown[] => {
    const values = res.daily?.[name];
    return Array.isArray(values) ? values : [];
  };
  const sunrises = daily("sunrise");
  const sunsets = daily("sunset");
  const daylight: ModelForecast["daylight"] = {};
  daily("time").forEach((day, i) => {
    const [sunrise, sunset] = [sunrises[i], sunsets[i]];
    if (typeof day === "string" && typeof sunrise === "string" && typeof sunset === "string")
      daylight[day] = { sunrise, sunset };
  });

  const surface = Object.fromEntries(SURFACE_VARIABLES.map((v) => [v, col(v)]));
  const levelColumns = PRESSURE_LEVELS.map((p) => ({
    pressure: p,
    speed: col(`wind_speed_${p}hPa`),
    direction: col(`wind_direction_${p}hPa`),
    temperature: col(`temperature_${p}hPa`),
    height: col(`geopotential_height_${p}hPa`),
  }));

  const hours: HourSample[] = times.map((time, i) => {
    const levels: LevelSample[] = levelColumns
      .map((c) => ({
        pressure: c.pressure,
        heightM: c.height[i] ?? STANDARD_HEIGHT_M[c.pressure],
        wind: makeWind(c.speed[i] ?? null, c.direction[i] ?? null),
        temperature: c.temperature[i] ?? null,
      }))
      .filter((l) => l.wind != null || l.temperature != null);
    return {
      time: String(time),
      temperature2m: surface.temperature_2m[i] ?? null,
      dewPoint2m: surface.dew_point_2m[i] ?? null,
      wind10m: makeWind(surface.wind_speed_10m[i] ?? null, surface.wind_direction_10m[i] ?? null),
      gust10m: surface.wind_gusts_10m[i] ?? null,
      precipitation: surface.precipitation[i] ?? null,
      cloudCover: surface.cloud_cover[i] ?? null,
      cloudCoverLow: surface.cloud_cover_low[i] ?? null,
      shortwave: surface.shortwave_radiation[i] ?? null,
      cape: surface.cape[i] ?? null,
      levels,
    };
  });

  return {
    model,
    groundElevation: asNumber(res.elevation) ?? 0,
    daylight,
    hours,
  };
}

export function hoursForDay(forecast: ModelForecast, day: string): HourSample[] {
  return forecast.hours.filter((h) => h.time.startsWith(day));
}
