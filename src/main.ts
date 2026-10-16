import "leaflet/dist/leaflet.css";
import "./style.css";
import sitesData from "./data/sites.json";
import { browserStore } from "./forecast/cache";
import { RateLimitError } from "./forecast/client";
import { loadSiteModels, rateForecast, rateSites, type SiteDay } from "./forecast/overview";
import type { ModelForecast, Site } from "./types";
import { dayRange, setupControls, type Selection } from "./ui/controls";
import { renderDetail, type DetailSelection } from "./ui/detail";
import { renderLegend } from "./ui/legend";
import { SiteLayer, createMap } from "./ui/map";

// About 400 of Open-Meteo's 600 free requests a minute: each site costs ~4 because of the many upper-air variables.
const MAX_RATED_SITES = 100;
const MOVE_DEBOUNCE_MS = 250;
const FALLBACK_HOUR = 13;

const sites = sitesData as Site[];
const sitesById = new Map(sites.map((s) => [s.id, s]));
const statusEl = document.getElementById("status")!;
const detailEl = document.getElementById("detail")!;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const store = browserStore();
store.prune(Date.now()).catch((err) => console.warn("Could not clear old forecasts", err));

function setStatus(text: string | null, isError = false): void {
  statusEl.hidden = text == null;
  statusEl.textContent = text ?? "";
  statusEl.classList.toggle("error", isError);
}

const map = createMap(document.getElementById("map")!);
const layer = new SiteLayer(map, sites, (site) => void openDetail(site));
renderLegend(document.getElementById("legend")!);

let selection: Selection;
let ratings = new Map<string, SiteDay>();
let ratingsKey = "";
let overviewAbort: AbortController | null = null;
let retryTimer: number | undefined;
let detail: { site: Site; forecasts: ModelForecast[] | null; error: string | null; sel: DetailSelection } | null = null;
let detailAbort: AbortController | null = null;
const range = dayRange();

async function refreshOverview(): Promise<void> {
  const key = `${selection.day}|${selection.model}`;
  if (key !== ratingsKey) {
    ratings = new Map();
    ratingsKey = key;
  }
  const bounds = map.getBounds();
  const c = map.getCenter();
  const cosLat = Math.cos((c.lat * Math.PI) / 180);
  const distance = (s: Site) => (s.lat - c.lat) ** 2 + ((s.lon - c.lng) * cosLat) ** 2;
  const visible = sites.filter((s) => bounds.contains([s.lat, s.lon])).sort((a, b) => distance(a) - distance(b));
  const note =
    visible.length > MAX_RATED_SITES
      ? `Rated the ${MAX_RATED_SITES} sites nearest the centre (${visible.length} in view). Zoom in to rate the rest.`
      : null;
  layer.update(ratings, selection.hour, sitesById);
  const todo = visible.slice(0, MAX_RATED_SITES).filter((s) => !ratings.has(s.id));
  if (todo.length === 0) return setStatus(note);
  overviewAbort?.abort();
  window.clearTimeout(retryTimer);
  const abort = (overviewAbort = new AbortController());
  setStatus(`Loading forecasts for ${todo.length} site${todo.length === 1 ? "" : "s"}…`);
  try {
    const got = await rateSites(todo, range, selection.day, selection.model, { store, signal: abort.signal });
    if (key !== ratingsKey) return;
    got.forEach((v, id) => ratings.set(id, v));
    layer.update(ratings, selection.hour, sitesById);
    setStatus(note);
  } catch (err) {
    if (abort.signal.aborted) return;
    setStatus(message(err), true);
    if (err instanceof RateLimitError && err.retryAfterMs != null)
      retryTimer = window.setTimeout(() => void refreshOverview(), err.retryAfterMs);
  }
}

function drawDetail(): void {
  if (!detail) {
    detailEl.hidden = true;
    return;
  }
  const { site, forecasts, error } = detail;
  const models = forecasts?.map((f) => ({ id: f.model, day: rateForecast(site, f, selection.day) })) ?? null;
  const fetchedAt = forecasts ? Math.min(...forecasts.map((f) => f.fetchedAt ?? Date.now())) : null;
  renderDetail(detailEl, { site, models, error, fetchedAt }, detail.sel, {
    onClose: () => {
      detailAbort?.abort();
      detail = null;
      drawDetail();
    },
    onSelect: (sel) => {
      detail!.sel = sel;
      controls.setHour(sel.hour);
      selection = controls.selection();
      layer.update(ratings, selection.hour, sitesById);
      drawDetail();
    },
  });
}

function startHour(site: Site): number {
  if (selection.hour != null) return selection.hour;
  const window = ratings.get(site.id)?.summary.window;
  return window ? Number(window.start.slice(0, 2)) : FALLBACK_HOUR;
}

async function openDetail(site: Site): Promise<void> {
  detailAbort?.abort();
  const abort = (detailAbort = new AbortController());
  detail = { site, forecasts: null, error: null, sel: { model: selection.model, hour: startHour(site) } };
  drawDetail();
  try {
    const forecasts = await loadSiteModels(site, range, { store, signal: abort.signal });
    if (abort.signal.aborted || !detail) return;
    detail.forecasts = forecasts;
  } catch (err) {
    if (abort.signal.aborted || !detail) return;
    detail.error = message(err);
  }
  drawDetail();
}

const controls = setupControls((next) => {
  selection = next;
  if (detail && next.hour != null) detail.sel = { ...detail.sel, hour: next.hour };
  void refreshOverview();
  drawDetail();
});
selection = controls.selection();

let moveTimer: number | undefined;
map.on("moveend", () => {
  window.clearTimeout(moveTimer);
  moveTimer = window.setTimeout(() => void refreshOverview(), MOVE_DEBOUNCE_MS);
});
void refreshOverview();
