import { LIMITS } from "../analysis/rating";
import { compass, directionFit } from "../analysis/wind";
import { NEAR_DISTANCE_M, STALE_AFTER_S, type Measure, type Station } from "../live/windsMobi";
import type { Site } from "../types";
import { el, fmtM } from "./format";
import { windChart } from "./windChart";

export type LiveState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stations: Station[]; history: Measure[] | null };

const FIT_TEXT = {
  good: "suits this launch",
  marginal: "marginal for this launch",
  cross: "crosswind",
  behind: "from behind the launch",
  unknown: "launch direction unknown",
};

function age(at: number, nowS: number): string {
  const min = Math.max(0, Math.round((nowS - at) / 60));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

function readingLine(site: Site, m: Measure | null, nowS: number): HTMLElement {
  if (!m || m.avgMs == null) return el("p", { class: "muted reading" }, "No recent measurement");
  const stale = nowS - m.at > STALE_AFTER_S;
  const gust = m.gustMs != null ? ` gusting ${m.gustMs.toFixed(1)}` : "";
  const calm = m.avgMs < LIMITS.nilWind;
  const dir = m.direction != null && !calm ? ` from ${compass(m.direction)}, ${FIT_TEXT[directionFit(site, m.direction).fit]}` : calm ? ", calm" : "";
  const when = `${age(m.at, nowS)}${stale ? ", stale" : ""}`;
  return el("p", { class: `reading${stale ? " muted" : ""}` }, el("strong", {}, `${m.avgMs.toFixed(1)} m/s${gust}`), `${dir} · ${when}`);
}

function stationBlock(site: Site, s: Station, nowS: number, history: Measure[] | null): HTMLElement {
  const where = [`${fmtM(s.distanceM)} from launch`, s.altM != null ? `${fmtM(s.altM)} altitude` : null, s.provider || null]
    .filter(Boolean)
    .join(" · ");
  const links = el("span", { class: "links" }, ...s.links.map((l) => el("a", { href: l.href, target: "_blank", rel: "noopener" }, l.label)));
  return el(
    "div",
    { class: "station" },
    el("div", { class: "station-head" }, el("strong", {}, s.name), links),
    el("p", { class: "muted station-meta" }, where),
    readingLine(site, s.last, nowS),
    history ? windChart(history, nowS) : null,
  );
}

export function renderLive(site: Site, live: LiveState, nowMs = Date.now()): HTMLElement {
  const title = el("h3", {}, "Live wind nearby");
  const nowS = nowMs / 1000;
  if (live.status === "loading") return el("section", {}, title, el("p", { class: "muted" }, "Loading stations from winds.mobi…"));
  if (live.status === "error") return el("section", {}, title, el("p", { class: "error-text" }, live.message));
  if (live.stations.length === 0)
    return el("section", {}, title, el("p", { class: "muted" }, `No weather station within ${NEAR_DISTANCE_M / 1000} km on winds.mobi.`));
  const [first, ...rest] = live.stations;
  return el(
    "section",
    { class: "live" },
    title,
    stationBlock(site, first, nowS, live.history),
    ...rest.map((s) => stationBlock(site, s, nowS, null)),
  );
}
