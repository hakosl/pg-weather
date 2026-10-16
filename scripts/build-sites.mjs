// Builds src/data/sites.json from Paragliding Earth plus terrain-derived launch facing and Holfuy club wind zones.
// Terrain: Kartverket's 1 m DTM (mainland Norway), falling back to Open-Meteo's 90 m DEM elsewhere (Svalbard).
import { writeFile } from "node:fs/promises";

const PGE_URL = "https://www.paraglidingearth.com/api/geojson/getCountrySites.php?iso=no&style=detailled";
const KARTVERKET_URL = "https://ws.geonorge.no/hoydedata/v1/punkt";
const KARTVERKET_MAX_POINTS = 50;
const KARTVERKET_INTERVAL_MS = 300;
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation";
// Each Open-Meteo elevation point counts as one call against its free quota.
const OPEN_METEO_INTERVAL_MS = 3000;
const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const RING_RADIUS_M = 600;
const BEARINGS = Array.from({ length: 24 }, (_, i) => i * 15);
const POINTS_PER_SITE = BEARINGS.length + 1;
const SITES_PER_CALL = Math.floor(KARTVERKET_MAX_POINTS / POINTS_PER_SITE);
const MIN_DROP_M = 80;
const MIN_DIRECTIONALITY = 0.35;
const ALTITUDE_MISMATCH_M = 100;
// A sector rated flyable that lies this far off the terrain facing would be a wind from behind.
const DISAGREE_DEG = 100;
const HOLFUY_URL = "https://api.holfuy.com/stations/stations.json";
// Club and private stations; kiting, sailing and airfield stations set zones for other sports.
const HOLFUY_TYPES = new Set(["Paragliding/HG", "Personal Weather station"]);
// Stations further away are usually at a different launch on the same mountain.
const HOLFUY_MAX_DISTANCE_M = 700;
// A green zone pointing well away from the terrain belongs to another launch nearby.
const HOLFUY_MAX_FACING_DIFF_DEG = 90;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`HTTP ${res.status}${body?.reason ? `: ${body.reason}` : ""}`);
      }
      return await res.json();
    } catch (err) {
      if (i === attempts) throw new Error(`${url.slice(0, 100)}… failed: ${err.message}`);
      await sleep(1500 * i);
    }
  }
}

function ringPoints(lat, lon) {
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return [
    [lat, lon],
    ...BEARINGS.map((b) => {
      const r = (b * Math.PI) / 180;
      return [lat + (RING_RADIUS_M * Math.cos(r)) / 111320, lon + (RING_RADIUS_M * Math.sin(r)) / mPerDegLon];
    }),
  ];
}

async function kartverketElevations(points) {
  const list = JSON.stringify(points.map(([lat, lon]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]));
  const body = await fetchJson(`${KARTVERKET_URL}?koordsys=4258&geojson=false&punkter=${encodeURIComponent(list)}`);
  if (body.punkter?.length !== points.length) throw new Error("Kartverket returned an unexpected number of points");
  return body.punkter.map((p) => (typeof p.z === "number" ? p.z : null));
}

async function openMeteoElevations(points) {
  const lat = points.map((p) => p[0].toFixed(5)).join(",");
  const lon = points.map((p) => p[1].toFixed(5)).join(",");
  const { elevation } = await fetchJson(`${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}`);
  return elevation;
}

function terrainFacing(elevations) {
  const [z0, ...ring] = elevations;
  let vx = 0;
  let vy = 0;
  let total = 0;
  ring.forEach((z, i) => {
    const r = (BEARINGS[i] * Math.PI) / 180;
    vx += (z0 - z) * Math.sin(r);
    vy += (z0 - z) * Math.cos(r);
    total += Math.abs(z0 - z);
  });
  const aspect = Math.round(((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360);
  const directionality = total > 0 ? Math.hypot(vx, vy) / total : 0;
  const dropM = Math.round(z0 - Math.min(...ring));
  const riseM = Math.round(Math.max(...ring) - z0);
  return {
    altDem: Math.round(z0),
    aspect,
    dropM,
    riseM,
    aspectReliable: dropM >= MIN_DROP_M && directionality >= MIN_DIRECTIONALITY,
  };
}

function peRatings(p) {
  const ratings = SECTORS.map((s) => Number(p[s] ?? 0) || 0);
  return ratings.some((r) => r > 0) ? ratings : null;
}

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Some Paragliding Earth names are UTF-8 read as Windows-1252 ("Ã…l" for "Ål"); re-encode and decode them.
const CP1252 = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };

function repairName(name) {
  if (!/[ÃÂ]/.test(name)) return name;
  const bytes = [...name].map((ch) => CP1252[ch] ?? ch.charCodeAt(0));
  if (bytes.some((b) => b > 0xff)) return name;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return name;
  }
}

function distanceM(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function holfuyZone(z) {
  const from = Number(z?.start);
  const to = Number(z?.stop);
  return Number.isFinite(from) && Number.isFinite(to) && !(from === 0 && to === 0) ? [from, to] : null;
}

function zoneCentre(zone) {
  if (!zone || zone[1] - zone[0] >= 360) return null;
  return (zone[0] + (((zone[1] - zone[0]) % 360) + 360) % 360 / 2) % 360;
}

function holfuyStations(list) {
  return list
    .filter((s) => s.location?.countryCode === "NO" && HOLFUY_TYPES.has(s.type))
    .filter((s) => Number.isFinite(s.location.latitude) && Number.isFinite(s.location.longitude))
    .map((s) => ({
      id: s.id,
      name: String(s.name).trim(),
      lat: s.location.latitude,
      lon: s.location.longitude,
      green: holfuyZone(s.directionZones?.green),
      yellow: holfuyZone(s.directionZones?.yellow),
    }))
    .filter((s) => s.green || s.yellow);
}

// Pairs a launch with a Holfuy station only when each is the other's nearest, close by, and facing the same way.
function withHolfuy(sites, stations) {
  const nearest = (from, candidates) =>
    candidates.reduce((best, c) => {
      const d = distanceM(from, c);
      return !best || d < best.d ? { item: c, d } : best;
    }, null);
  const siteOfStation = new Map(stations.map((st) => [st.id, nearest(st, sites)?.item]));
  const rejected = [];
  const result = sites.map((site) => {
    const match = nearest(site, stations);
    if (!match || match.d > HOLFUY_MAX_DISTANCE_M || siteOfStation.get(match.item.id) !== site) return { ...site, holfuy: null };
    const st = match.item;
    const centre = zoneCentre(st.green ?? st.yellow);
    if (site.aspectReliable && centre != null && angleDiff(centre, site.aspect) > HOLFUY_MAX_FACING_DIFF_DEG) {
      rejected.push(`${site.name} ↔ ${st.name}: zones face ${Math.round(centre)}°, terrain ${site.aspect}°`);
      return { ...site, holfuy: null };
    }
    return { ...site, holfuy: { id: st.id, name: st.name, distanceM: Math.round(match.d), green: st.green, yellow: st.yellow } };
  });
  return { sites: result, rejected };
}

function toNumberOrNull(v) {
  const n = Number(v);
  return v === "" || v == null || !Number.isFinite(n) || n === 0 ? null : n;
}

function toSite(f, terrain, terrainSource) {
  const p = f.properties;
  const ratings = peRatings(p);
  const altPe = toNumberOrNull(p.takeoff_altitude);
  const landingLat = toNumberOrNull(p.landing_lat);
  const landingLon = toNumberOrNull(p.landing_lng);
  return {
    id: p.pge_site_id,
    name: repairName(p.name.trim()),
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    altPe,
    ...terrain,
    terrainSource,
    ratings,
    sourcesDisagree:
      ratings != null &&
      terrain.aspectReliable &&
      ratings.some((r, i) => r >= 1 && angleDiff(i * 45, terrain.aspect) > DISAGREE_DEG),
    altitudeMismatch: altPe != null && Math.abs(altPe - terrain.altDem) > ALTITUDE_MISMATCH_M,
    soaring: p.soaring === "1",
    thermals: p.thermals === "1",
    landing: landingLat != null && landingLon != null ? { lat: landingLat, lon: landingLon } : null,
    link: `https://www.paraglidingearth.com/?site=${p.pge_site_id}`,
  };
}

async function main() {
  const pge = await fetchJson(PGE_URL);
  const features = pge.features.filter((f) => f.properties.paragliding === "1");
  console.log(`Paragliding Earth: ${features.length} sites`);

  const sites = [];
  const outsideKartverket = [];
  for (let i = 0; i < features.length; i += SITES_PER_CALL) {
    const batch = features.slice(i, i + SITES_PER_CALL);
    const points = batch.flatMap((f) => ringPoints(f.geometry.coordinates[1], f.geometry.coordinates[0]));
    const elevations = await kartverketElevations(points);
    batch.forEach((f, j) => {
      const z = elevations.slice(j * POINTS_PER_SITE, (j + 1) * POINTS_PER_SITE);
      if (z.some((v) => v == null)) outsideKartverket.push(f);
      else sites.push(toSite(f, terrainFacing(z), "kartverket-dtm1"));
    });
    process.stdout.write(`\rKartverket terrain ${Math.min(i + SITES_PER_CALL, features.length)}/${features.length}`);
    await sleep(KARTVERKET_INTERVAL_MS);
  }
  console.log();

  const skipped = [];
  for (const f of outsideKartverket) {
    try {
      const z = await openMeteoElevations(ringPoints(f.geometry.coordinates[1], f.geometry.coordinates[0]));
      sites.push(toSite(f, terrainFacing(z), "copernicus-90m"));
    } catch (err) {
      skipped.push(`${f.properties.name} (${err.message})`);
    }
    await sleep(OPEN_METEO_INTERVAL_MS);
  }
  console.log(`Open-Meteo fallback: ${outsideKartverket.length - skipped.length}/${outsideKartverket.length} sites`);
  if (skipped.length) console.warn(`Skipped, rerun later:\n  ${skipped.join("\n  ")}`);

  const holfuy = holfuyStations((await fetchJson(HOLFUY_URL)).holfuyStationsList ?? []);
  const { sites: final, rejected } = withHolfuy(sites, holfuy);
  console.log(`Holfuy: ${final.filter((s) => s.holfuy).length} launches matched to ${holfuy.length} stations with wind zones`);
  if (rejected.length) console.log(`Not matched, zones face another way:\n  ${rejected.join("\n  ")}`);

  final.sort((a, b) => a.name.localeCompare(b.name, "nb"));
  await writeFile(new URL("../src/data/sites.json", import.meta.url), JSON.stringify(final, null, 1) + "\n");
  console.log(`Wrote ${final.length} sites to src/data/sites.json`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
