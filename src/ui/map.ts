import L from "leaflet";
import { limitingMeasures } from "../analysis/rating";
import type { SiteDay } from "../forecast/overview";
import type { FlyState, Site, Wind } from "../types";
import { STATE_META, blockersText, hourOf, measuresText } from "./format";

const VIEW_KEY = "pg-weather:view";
// Opens on the Oslo and Ringerike sites, few enough to rate straight away.
const DEFAULT_VIEW = { lat: 60.1, lon: 10.2, zoom: 9 };

function loadView(): typeof DEFAULT_VIEW {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) && Number.isFinite(saved.zoom)) return saved;
  } catch {
    // Storage can be unavailable; the default view is fine.
  }
  return DEFAULT_VIEW;
}

export function createMap(container: HTMLElement): L.Map {
  const view = loadView();
  const map = L.map(container, { zoomControl: false }).setView([view.lat, view.lon], view.zoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution:
      'Map: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) | Sites: <a href="https://www.paraglidingearth.com">Paragliding Earth</a> | Weather: <a href="https://open-meteo.com">Open-Meteo</a>',
  }).addTo(map);
  map.on("moveend", () => {
    const c = map.getCenter();
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
    } catch {
      // Not remembering the view is harmless.
    }
  });
  return map;
}

function markerSvg(state: FlyState, wind: Wind | null): string {
  const color = STATE_META[state].color;
  const r = state === "nodata" ? 5 : 7;
  let arrow = "";
  if (wind && wind.speed >= 0.5) {
    // Points downwind, like the flow on a wind map; longer for stronger wind.
    const len = 9 + Math.min(wind.speed, 12);
    arrow = `<g transform="rotate(${wind.direction + 180} 14 14)">
      <line x1="14" y1="14" x2="14" y2="${14 - len}" stroke="var(--fg)" stroke-width="2" stroke-linecap="round"/>
      <path d="M10.5 ${17 - len} L14 ${12 - len} L17.5 ${17 - len} Z" fill="var(--fg)"/></g>`;
  }
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">${arrow}
    <circle cx="14" cy="14" r="${r}" fill="${color}" stroke="var(--surface)" stroke-width="2"/></svg>`;
}

function tooltipDetail(day: SiteDay, slot: SiteDay["hours"][number] | null): string {
  if (slot) {
    const measures = limitingMeasures(slot);
    return measures.length ? `: ${measuresText(measures)}` : "";
  }
  if (day.summary.blockers.length) return `: ${blockersText(day.summary.blockers)}`;
  const w = day.summary.window;
  return w ? ` ${w.start}–${w.end}` : "";
}

export class SiteLayer {
  private markers = new Map<string, L.Marker>();

  constructor(map: L.Map, sites: Site[], onSelect: (site: Site) => void) {
    for (const site of sites) {
      const marker = L.marker([site.lat, site.lon], { icon: this.icon("nodata", null), keyboard: true, title: site.name })
        .bindTooltip(site.name, { direction: "top", offset: [0, -8] })
        .on("click", () => onSelect(site))
        .addTo(map);
      this.markers.set(site.id, marker);
    }
  }

  private icon(state: FlyState, wind: Wind | null): L.DivIcon {
    return L.divIcon({ className: "site-marker", html: markerSvg(state, wind), iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  update(ratings: Map<string, SiteDay>, hour: number | null, sitesById: Map<string, Site>): void {
    for (const [id, marker] of this.markers) {
      const day = ratings.get(id);
      const site = sitesById.get(id)!;
      if (!day) {
        marker.setIcon(this.icon("nodata", null));
        marker.setTooltipContent(site.name);
        continue;
      }
      const slot = hour == null ? null : day.hours.find((h) => hourOf(h.time) === hour) ?? null;
      const state = slot ? slot.state : day.summary.state ?? "nodata";
      marker.setIcon(this.icon(state, slot?.launchWind ?? null));
      marker.setTooltipContent(`${site.name}: ${STATE_META[state].label}${tooltipDetail(day, slot)}`);
    }
  }
}
