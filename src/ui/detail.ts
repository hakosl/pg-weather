import { limitingMeasures, type HourRating } from "../analysis/rating";
import { GLIDER_SINK_MS, SENSIBLE_HEAT_FRACTION, type HeatSource } from "../analysis/thermals";
import { compass, siteFacing } from "../analysis/wind";
import { FORECAST_TTL_MS } from "../forecast/cache";
import { MODELS } from "../forecast/client";
import type { SiteDay } from "../forecast/overview";
import type { ModelId, Site, Wind } from "../types";
import { HOURS, REASON_COLOR, STATE_META, arrow, blockersText, el, fmtM, hourOf, measuresText, pad2, pill, sky, svg } from "./format";
import { renderLive, type LiveState } from "./live";

export interface DetailData {
  site: Site;
  models: { id: ModelId; day: SiteDay }[] | null;
  error: string | null;
  /** When the oldest of the shown forecasts was fetched. */
  fetchedAt: number | null;
  live: LiveState;
  favorite: boolean;
}

export interface DetailSelection {
  model: ModelId;
  hour: number;
}

interface Handlers {
  onClose: () => void;
  onSelect: (sel: DetailSelection) => void;
  onToggleFavorite: () => void;
}

const FIT_LABEL = { good: "good", marginal: "marginal", cross: "cross", behind: "from behind", unknown: "unknown" };

const ZONE_RING_R = 42;

function zoneArc(zone: [number, number], color: string, at: (deg: number, r: number) => number[], c: number): SVGElement {
  const style = { fill: "none", stroke: color, "stroke-width": 6 };
  if (zone[1] - zone[0] >= 360) return svg("circle", { cx: c, cy: c, r: ZONE_RING_R, ...style });
  const span = (((zone[1] - zone[0]) % 360) + 360) % 360;
  const [x1, y1] = at(zone[0], ZONE_RING_R);
  const [x2, y2] = at(zone[0] + span, ZONE_RING_R);
  return svg("path", { d: `M${x1} ${y1} A${ZONE_RING_R} ${ZONE_RING_R} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`, ...style });
}

function rose(site: Site, wind: Wind | null): SVGElement {
  const c = 52;
  const r = 36;
  const at = (deg: number, radius: number) => [c + radius * Math.sin((deg * Math.PI) / 180), c - radius * Math.cos((deg * Math.PI) / 180)];
  const root = svg("svg", { width: 104, height: 104, viewBox: "0 0 104 104", role: "img", "aria-label": "Launch directions" });
  root.append(svg("circle", { cx: c, cy: c, r: ZONE_RING_R, fill: "none", stroke: "var(--surface-2)", "stroke-width": 6 }));
  if (site.holfuy?.yellow) root.append(zoneArc(site.holfuy.yellow, "var(--marginal)", at, c));
  if (site.holfuy?.green) root.append(zoneArc(site.holfuy.green, "var(--soar)", at, c));
  for (let i = 0; i < 8; i++) {
    const [x1, y1] = at(i * 45 - 22.5, r);
    const [x2, y2] = at(i * 45 + 22.5, r);
    const rating = site.ratings?.[i];
    const fill = rating === 2 ? "var(--soar)" : rating === 1 ? "var(--marginal)" : "var(--surface-2)";
    root.append(svg("path", { d: `M${c} ${c} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`, fill, stroke: "var(--line)" }));
  }
  const [ax, ay] = at(site.aspect, r - 6);
  root.append(
    svg("line", { x1: c, y1: c, x2: ax, y2: ay, stroke: "var(--fg)", "stroke-width": 2.5, "stroke-linecap": "round", "stroke-dasharray": site.aspectReliable ? "" : "3 3" }),
  );
  if (wind && wind.speed >= 0.5) {
    const [wx, wy] = at(wind.direction, r + 4);
    const [tx, ty] = at(wind.direction, r - 12);
    root.append(svg("line", { x1: wx, y1: wy, x2: tx, y2: ty, stroke: "var(--accent)", "stroke-width": 3, "stroke-linecap": "round" }));
  }
  const n = svg("text", { x: c, y: 7, "text-anchor": "middle", "font-size": 9, fill: "var(--muted)" });
  n.textContent = "N";
  root.append(n);
  return root;
}

function siteFlags(site: Site): HTMLElement {
  const items: [string, boolean][] = [];
  if (site.holfuy) items.push([`Outer ring: wind zones the club set on its Holfuy station, ${site.holfuy.name}`, false]);
  if (site.ratings) items.push(["Filled sectors: Paragliding Earth's ratings", false]);
  if (site.aspectReliable) items.push(["Black line: which way the terrain faces", false]);
  else if (site.holfuy || site.ratings) items.push(["Dashed line: the terrain shows no clear facing here", false]);
  else items.push(["No wind directions known for this launch: direction checks are off", true]);
  if (site.sourcesDisagree) items.push(["Paragliding Earth and the terrain point different ways: check locally", true]);
  if (site.altitudeMismatch)
    items.push([`Listed at ${fmtM(site.altPe!)}, but the terrain at the pin is ${fmtM(site.altDem)}: the pin may be off`, true]);
  items.push(["Blue line: launch wind from the selected model and hour", false]);
  return el("ul", { class: "flags" }, ...items.map(([t, warn]) => el("li", warn ? { class: "warn" } : {}, t)));
}

function header(site: Site, favorite: boolean, handlers: Handlers): HTMLElement {
  const facing = siteFacing(site);
  const star = el("button", { type: "button", class: "close fav-toggle", "aria-pressed": String(favorite) }, el("span", { "aria-hidden": "true" }, favorite ? "★" : "☆"), " Favorite");
  star.addEventListener("click", handlers.onToggleFavorite);
  const close = el("button", { type: "button", class: "close", "aria-label": "Close" }, "Close");
  close.addEventListener("click", handlers.onClose);
  const parts = [`Launch ${fmtM(site.altDem)}`, facing != null ? `faces ${compass(facing)}` : "facing unknown", `${fmtM(site.dropM)} drop nearby`];
  return el("div", { class: "detail-head" }, el("h2", {}, site.name), el("div", { class: "head-actions" }, star, close), el("p", { class: "meta" }, parts.join(" · ")));
}

function verdict(models: NonNullable<DetailData["models"]>, sel: DetailSelection): HTMLElement {
  const model = models.find((m) => m.id === sel.model) ?? models[0];
  const label = MODELS.find((m) => m.id === model.id)!.label;
  const { state, window, blockers } = model.day.summary;
  if (!state) return el("p", { class: "verdict" }, `${label}: no forecast for this day.`);
  const text = blockers.length
    ? ` Held back by ${blockersText(blockers)}.`
    : window
      ? ` ${window.start}–${window.end}.`
      : "";
  return el("p", { class: "verdict" }, el("strong", {}, `${label}:`), pill(state), text);
}

const ratingAt = (day: SiteDay, hour: number) => day.hours.find((h) => hourOf(h.time) === hour) ?? null;
const windText = (w: Wind) => `${w.speed.toFixed(1)} ${compass(w.direction)}`;

function fetchedNote(fetchedAt: number | null): HTMLElement | null {
  if (fetchedAt == null) return null;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(fetchedAt);
  return el("p", { class: "muted fetched" }, `Fetched ${time}, refreshed after ${FORECAST_TTL_MS / 3_600_000} hours`);
}

// One hour of one model: the sky above a tile in the hour's rating color, with launch wind, its direction and the gust.
function hourSlot(id: ModelId, h: number, r: HourRating | null, selected: boolean, onSelect: Handlers["onSelect"]): HTMLElement {
  const state = r?.state ?? "nodata";
  const measures = r ? limitingMeasures(r) : [];
  const why = measures.length ? `: ${measuresText(measures)}` : "";
  const gust = r?.sample.gust10m ?? null;
  const gustText = gust != null ? gust.toFixed(1) : "–";
  const conditions = r ? sky(r) : null;
  const wind = r?.launchWind ? `. Wind ${windText(r.launchWind)}${gust != null ? `, gusts ${gustText}` : ""} m/s` : "";
  const title = `${modelLabel(id)} ${pad2(h)}:00 ${STATE_META[state].label}${why}${wind}${conditions ? `. ${conditions.label}` : ""}`;
  const content = r?.launchWind ? [arrow(r.launchWind), el("b", {}, r.launchWind.speed.toFixed(1)), el("small", {}, gust != null ? `(${gustText})` : gustText)] : [];
  const b = el("button", { type: "button", class: `cell${selected ? " selected" : ""}`, title, "aria-label": title, "aria-pressed": String(selected) }, ...content);
  b.style.background = STATE_META[state].color;
  b.addEventListener("click", () => onSelect({ model: id, hour: h }));
  return el("div", { class: "slot" }, el("span", { class: "sky", "aria-hidden": "true" }, conditions?.icon ?? ""), b);
}

function strips(models: NonNullable<DetailData["models"]>, sel: DetailSelection, onSelect: Handlers["onSelect"]): HTMLElement {
  const rows = models.map(({ id, day }) => {
    const w = day.summary.window;
    const sub = day.summary.state ? `${STATE_META[day.summary.state].label}${w ? ` ${w.start.slice(0, 2)}–${w.end.slice(0, 2)}` : ""}` : "No data";
    const slots = HOURS.map((h) => hourSlot(id, h, ratingAt(day, h), id === sel.model && h === sel.hour, onSelect));
    return el("div", { class: "strip" }, el("div", { class: "strip-label" }, modelLabel(id), el("small", {}, sub)), el("div", { class: "cells" }, ...slots));
  });
  const axis = el("div", { class: "hours-axis" }, el("span"), el("div", { class: "cells" }, ...HOURS.map((h) => el("span", {}, pad2(h)))));
  return el("section", { class: "strips" }, el("h3", {}, "Hour by hour, per model (wind and gust, m/s)"), el("div", { class: "strips-scroll" }, ...rows, axis));
}

// A value with an optional muted second line, so narrow columns wrap cleanly.
const twoLine = (main: string, sub: string | null) => el("span", {}, main, sub ? el("small", { class: "sub" }, sub) : null);

const ROWS: [string, (r: HourRating) => Node | string][] = [
  ["Launch wind", (r) => (r.launchWind ? twoLine(windText(r.launchWind), r.launchWindSource === "near-ground" ? "near ground" : null) : "–")],
  ["Direction", (r) => (r.direction ? FIT_LABEL[r.direction.fit] : "–")],
  ["Onto slope", (r) => (r.ontoSlopeMs != null ? r.ontoSlopeMs.toFixed(1) : "–")],
  ["Up to 500\u00a0m above", (r) => (r.above ? twoLine(windText(r.above.wind), `at ${fmtM(r.above.heightM)}`) : "–")],
  ["Gusts", (r) => (r.sample.gust10m != null ? twoLine(`${r.sample.gust10m.toFixed(1)} gust`, `${r.sample.wind10m?.speed.toFixed(1) ?? "–"} mean`) : "–")],
  ["Thermals", (r) => (r.thermals && r.thermals.strength !== "none" ? twoLine(r.thermals.strength, `to ${fmtM(r.thermals.ceilingM)}`) : r.thermals ? "none" : "–")],
  ["Thermal climb", (r) => (r.thermals && r.thermals.strength !== "none" ? twoLine(r.thermals.climbMs.toFixed(1), `w* ${r.thermals.wStar.toFixed(1)}`) : "–")],
  ["Cloud", (r) => (r.thermals?.cumulus ? twoLine("Cu base", fmtM(r.thermals.cloudBaseM!)) : r.sample.cloudCover != null ? `${Math.round(r.sample.cloudCover)}%` : "–")],
  ["Rain", (r) => (r.sample.precipitation != null ? `${r.sample.precipitation.toFixed(1)} mm` : "–")],
];

const modelLabel = (id: ModelId) => MODELS.find((m) => m.id === id)!.label;
const listText = (items: string[]) => new Intl.ListFormat("en-GB", { type: "conjunction" }).format(items);

// Says which models' thermal strength comes from their own heat flux, so a column that reads stronger can be explained.
function heatNote(ratings: { id: ModelId; r: HourRating | null }[]): HTMLElement | null {
  const from = (source: HeatSource) => ratings.filter(({ r }) => r?.thermals?.heatSource === source).map(({ id }) => modelLabel(id));
  const [model, sunshine] = [from("model"), from("sunshine")];
  const parts = [
    model.length ? `${listText(model)} from ${model.length > 1 ? "their" : "its"} own heat flux` : null,
    sunshine.length ? `${listText(sunshine)} estimated as ${SENSIBLE_HEAT_FRACTION * 100}% of the sunshine` : null,
  ].filter((p): p is string => p != null);
  if (parts.length === 0) return null;
  return el("p", { class: "muted table-note" }, `Thermal climb is w* less ${GLIDER_SINK_MS} m/s of glider sink. Ground heating: ${parts.join("; ")}.`);
}

function compare(models: NonNullable<DetailData["models"]>, sel: DetailSelection, onSelect: Handlers["onSelect"]): HTMLElement {
  const ratings = models.map((m) => ({ id: m.id, r: ratingAt(m.day, sel.hour) }));
  const head = el("tr", {}, el("th", {}, `${pad2(sel.hour)}:00`), ...ratings.map(({ id }) => {
    const b = el("button", { type: "button" }, MODELS.find((m) => m.id === id)!.label);
    b.addEventListener("click", () => onSelect({ model: id, hour: sel.hour }));
    return el("th", id === sel.model ? { class: "active" } : {}, b);
  }));
  const stateRow = el("tr", {}, el("th", {}, "Rating"), ...ratings.map(({ r }) => {
    const state = r?.state ?? "nodata";
    const measures = r ? limitingMeasures(r) : [];
    return el("td", {}, pill(state), measures.length ? el("div", { class: "why" }, measuresText(measures)) : null);
  }));
  const body = ROWS.map(([label, fn]) => el("tr", {}, el("th", {}, label), ...ratings.map(({ r }) => el("td", {}, r ? fn(r) : "–"))));
  const table = el("table", { class: "compare" }, el("thead", {}, head), el("tbody", {}, stateRow, ...body));
  return el("section", {}, el("h3", {}, "Models side by side (m/s, m above sea level)"), el("div", { class: "table-wrap" }, table), heatNote(ratings));
}

function reasons(models: NonNullable<DetailData["models"]>, sel: DetailSelection): HTMLElement {
  const model = models.find((m) => m.id === sel.model) ?? models[0];
  const r = ratingAt(model.day, sel.hour);
  const label = MODELS.find((m) => m.id === model.id)!.label;
  const items = (r?.reasons ?? [{ level: "info" as const, text: "No forecast for this hour" }]).map((x) => {
    const mark = el("span", { class: "mark" });
    mark.style.background = REASON_COLOR[x.level];
    return el("li", {}, mark, el("span", {}, x.text));
  });
  return el("section", {}, el("h3", {}, `Why: ${label} at ${pad2(sel.hour)}:00`), el("ul", { class: "reasons" }, ...items));
}

const SELECTED_MARGIN_PX = 6;

// Each render builds a new strip, so put it back where the user scrolled it, then bring the selected hour into view.
function restoreStripScroll(container: HTMLElement, scrollLeft: number | null): void {
  const scroller = container.querySelector<HTMLElement>(".strips-scroll");
  if (!scroller) return;
  if (scrollLeft != null) scroller.scrollLeft = scrollLeft;
  const tile = scroller.querySelector(".cell.selected")?.getBoundingClientRect();
  if (!tile) return;
  const pinnedRight = scroller.querySelector(".strip-label")!.getBoundingClientRect().right;
  const viewRight = scroller.getBoundingClientRect().right;
  if (tile.left < pinnedRight) scroller.scrollLeft -= pinnedRight - tile.left + SELECTED_MARGIN_PX;
  else if (tile.right > viewRight) scroller.scrollLeft += tile.right - viewRight + SELECTED_MARGIN_PX;
}

export function renderDetail(container: HTMLElement, data: DetailData, sel: DetailSelection, handlers: Handlers): void {
  const stripScroll = container.querySelector(".strips-scroll")?.scrollLeft ?? null;
  const { site } = data;
  const selected = data.models?.find((m) => m.id === sel.model) ?? null;
  const wind = selected ? ratingAt(selected.day, sel.hour)?.launchWind ?? null : null;
  const links = el(
    "div",
    { class: "links" },
    el("a", { href: site.link, target: "_blank", rel: "noopener" }, "Paragliding Earth"),
    el("a", { href: `https://www.windy.com/?${site.lat},${site.lon},12`, target: "_blank", rel: "noopener" }, "Windy"),
  );
  const parts: (Node | null)[] = [
    header(site, data.favorite, handlers),
    el("div", { class: "site-facts" }, rose(site, wind), siteFlags(site)),
    links,
    renderLive(site, data.live),
  ];
  if (data.error) parts.push(el("p", { class: "error-text" }, data.error));
  else if (!data.models) parts.push(el("p", { class: "muted" }, "Loading all four models…"));
  else
    parts.push(
      verdict(data.models, sel),
      fetchedNote(data.fetchedAt),
      strips(data.models, sel, handlers.onSelect),
      compare(data.models, sel, handlers.onSelect),
      reasons(data.models, sel),
    );
  container.replaceChildren(...parts.filter((p): p is Node => p != null));
  container.hidden = false;
  restoreStripScroll(container, stripScroll);
}
