import { limitingMeasures, type HourRating } from "../analysis/rating";
import { compass, siteFacing } from "../analysis/wind";
import { FORECAST_TTL_MS } from "../forecast/cache";
import { MODELS } from "../forecast/client";
import type { SiteDay } from "../forecast/overview";
import type { FlyState, ModelId, Site, Wind } from "../types";
import { REASON_COLOR, STATE_META, blockersText, el, fmtM, hourOf, measuresText, pad2 } from "./format";

export interface DetailData {
  site: Site;
  models: { id: ModelId; day: SiteDay }[] | null;
  error: string | null;
  /** When the oldest of the shown forecasts was fetched. */
  fetchedAt: number | null;
}

export interface DetailSelection {
  model: ModelId;
  hour: number;
}

interface Handlers {
  onClose: () => void;
  onSelect: (sel: DetailSelection) => void;
}

const FIRST_HOUR = 6;
const LAST_HOUR = 21;
const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
const SVG_NS = "http://www.w3.org/2000/svg";
const FIT_LABEL = { good: "good", marginal: "marginal", cross: "cross", behind: "from behind", unknown: "unknown" };

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function rose(site: Site, wind: Wind | null): SVGElement {
  const c = 46;
  const r = 40;
  const at = (deg: number, radius: number) => [c + radius * Math.sin((deg * Math.PI) / 180), c - radius * Math.cos((deg * Math.PI) / 180)];
  const root = svg("svg", { width: 92, height: 92, viewBox: "0 0 92 92", role: "img", "aria-label": "Launch directions" });
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
  const n = svg("text", { x: c, y: 9, "text-anchor": "middle", "font-size": 9, fill: "var(--muted)" });
  n.textContent = "N";
  root.append(n);
  return root;
}

function siteFlags(site: Site): HTMLElement {
  const items: [string, boolean][] = [];
  if (site.ratings) items.push(["Wind directions rated on Paragliding Earth (filled sectors)", false]);
  else if (site.aspectReliable) items.push(["Not rated on Paragliding Earth: facing estimated from terrain (black line)", false]);
  else items.push(["Not rated on Paragliding Earth and the terrain shows no clear facing: direction checks are off", true]);
  if (site.sourcesDisagree) items.push(["Paragliding Earth and the terrain point different ways: check locally", true]);
  if (site.altitudeMismatch)
    items.push([`Listed at ${fmtM(site.altPe!)}, but the terrain at the pin is ${fmtM(site.altDem)}: the pin may be off`, true]);
  items.push(["Blue line: launch wind from the selected model and hour", false]);
  return el("ul", { class: "flags" }, ...items.map(([t, warn]) => el("li", warn ? { class: "warn" } : {}, t)));
}

function header(site: Site, onClose: () => void): HTMLElement {
  const facing = siteFacing(site);
  const close = el("button", { type: "button", class: "close", "aria-label": "Close" }, "Close");
  close.addEventListener("click", onClose);
  const parts = [`Launch ${fmtM(site.altDem)}`, facing != null ? `faces ${compass(facing)}` : "facing unknown", `${fmtM(site.dropM)} drop nearby`];
  return el("div", { class: "detail-head" }, el("h2", {}, site.name), close, el("p", { class: "meta" }, parts.join(" · ")));
}

function pill(state: FlyState): HTMLElement {
  const node = el("span", { class: "state-pill" }, STATE_META[state].label);
  node.style.background = STATE_META[state].color;
  return node;
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

function strips(models: NonNullable<DetailData["models"]>, sel: DetailSelection, onSelect: Handlers["onSelect"]): HTMLElement {
  const rows = models.map(({ id, day }) => {
    const label = MODELS.find((m) => m.id === id)!.label;
    const w = day.summary.window;
    const sub = day.summary.state ? `${STATE_META[day.summary.state].label}${w ? ` ${w.start.slice(0, 2)}–${w.end.slice(0, 2)}` : ""}` : "No data";
    const cells = HOURS.map((h) => {
      const r = ratingAt(day, h);
      const state = r?.state ?? "nodata";
      const selected = id === sel.model && h === sel.hour;
      const measures = r ? limitingMeasures(r) : [];
      const why = measures.length ? `: ${measuresText(measures)}` : "";
      const title = `${label} ${pad2(h)}:00 ${STATE_META[state].label}${why}`;
      const b = el("button", { type: "button", class: `cell${selected ? " selected" : ""}`, title, "aria-pressed": String(selected) });
      b.style.background = STATE_META[state].color;
      b.addEventListener("click", () => onSelect({ model: id, hour: h }));
      return b;
    });
    return el("div", { class: "strip" }, el("div", { class: "strip-label" }, label, el("small", {}, sub)), el("div", { class: "cells" }, ...cells));
  });
  const axis = el("div", { class: "hours-axis" }, el("span"), el("div", { class: "cells" }, ...HOURS.map((h) => el("span", {}, h % 3 === 0 ? pad2(h) : ""))));
  return el("section", { class: "strips" }, el("h3", {}, "Hour by hour, per model"), ...rows, axis);
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
  ["Cloud", (r) => (r.thermals?.cumulus ? twoLine("Cu base", fmtM(r.thermals.cloudBaseM!)) : r.sample.cloudCover != null ? `${Math.round(r.sample.cloudCover)}%` : "–")],
  ["Rain", (r) => (r.sample.precipitation != null ? `${r.sample.precipitation.toFixed(1)} mm` : "–")],
];

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
  return el("section", {}, el("h3", {}, "Models side by side (m/s, m above sea level)"), el("div", { class: "table-wrap" }, table));
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

export function renderDetail(container: HTMLElement, data: DetailData, sel: DetailSelection, handlers: Handlers): void {
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
    header(site, handlers.onClose),
    el("div", { class: "site-facts" }, rose(site, wind), siteFlags(site)),
    links,
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
}
