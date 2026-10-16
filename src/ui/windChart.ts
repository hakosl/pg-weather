import { compass } from "../analysis/wind";
import { HISTORY_DURATION_S, type Measure } from "../live/windsMobi";
import { el } from "./format";

// One axis in m/s: average solid, gust dashed, both in the accent hue and named by direct labels.
const W = 320;
const H = 104;
const PAD = { left: 24, right: 36, top: 10, bottom: 18 };
const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_Y_MAX = 6;

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function text(x: number, y: number, value: string, anchor = "start"): SVGElement {
  const t = svg("text", { x, y, "text-anchor": anchor, "font-size": 10, fill: "var(--muted)" });
  t.textContent = value;
  return t;
}

const clockOf = (at: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(at * 1000);

function readoutText(m: Measure): string {
  const speeds = `${m.avgMs?.toFixed(1) ?? "–"} average, ${m.gustMs?.toFixed(1) ?? "–"} gust`;
  return `${clockOf(m.at)} · ${speeds} m/s${m.direction != null ? ` from ${compass(m.direction)}` : ""}`;
}

export function windChart(measures: Measure[], nowS: number): HTMLElement | null {
  const points = measures.filter((m) => m.avgMs != null || m.gustMs != null);
  if (points.length < 2) return null;
  const t0 = nowS - HISTORY_DURATION_S;
  const yMax = Math.max(MIN_Y_MAX, Math.ceil(Math.max(...points.map((m) => m.gustMs ?? m.avgMs ?? 0)) / 2) * 2);
  const x = (at: number) => PAD.left + ((at - t0) / HISTORY_DURATION_S) * (W - PAD.left - PAD.right);
  const y = (v: number) => H - PAD.bottom - (v / yMax) * (H - PAD.top - PAD.bottom);
  const path = (pick: (m: Measure) => number | null) =>
    points.filter((m) => pick(m) != null).map((m, i) => `${i ? "L" : "M"}${x(m.at).toFixed(1)} ${y(pick(m)!).toFixed(1)}`).join(" ");

  const last = points[points.length - 1];
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", class: "wind-chart" });
  root.setAttribute("aria-label", `Measured wind, last 2 hours. Latest: ${readoutText(last)}`);
  for (const v of [0, yMax / 2, yMax]) {
    root.append(svg("line", { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), stroke: "var(--line)", "stroke-width": 1 }));
    root.append(text(PAD.left - 4, y(v) + 3, String(v), "end"));
  }
  [["−2 h", t0], ["−1 h", t0 + HISTORY_DURATION_S / 2], ["now", nowS]].forEach(([label, at]) =>
    root.append(text(x(at as number), H - 4, label as string, "middle")),
  );
  root.append(svg("path", { d: path((m) => m.gustMs), fill: "none", stroke: "var(--accent)", "stroke-width": 2, "stroke-dasharray": "4 3", opacity: 0.55 }));
  root.append(svg("path", { d: path((m) => m.avgMs), fill: "none", stroke: "var(--accent)", "stroke-width": 2, "stroke-linejoin": "round" }));
  if (last.avgMs != null)
    root.append(svg("circle", { cx: x(last.at), cy: y(last.avgMs), r: 4, fill: "var(--accent)", stroke: "var(--surface)", "stroke-width": 2 }));

  // Direct labels at the line ends, nudged apart when the two ends nearly meet.
  const avgY = y(last.avgMs ?? 0);
  const gustY = Math.min(y(last.gustMs ?? 0), avgY - 11);
  root.append(text(x(last.at) + 7, avgY + 3, "avg"), text(x(last.at) + 7, gustY + 3, "gust"));

  const cursor = svg("line", { y1: PAD.top, y2: H - PAD.bottom, stroke: "var(--muted)", "stroke-width": 1, visibility: "hidden" });
  const hit = svg("rect", { x: PAD.left, y: 0, width: W - PAD.left - PAD.right, height: H, fill: "transparent" });
  root.append(cursor, hit);

  const readout = el("p", { class: "chart-readout" }, readoutText(last));
  const show = (m: Measure | null) => {
    readout.textContent = readoutText(m ?? last);
    cursor.setAttribute("visibility", m ? "visible" : "hidden");
    if (m) {
      cursor.setAttribute("x1", String(x(m.at)));
      cursor.setAttribute("x2", String(x(m.at)));
    }
  };
  hit.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const at = t0 + (((e.clientX - box.left) / box.width) * W - PAD.left) / ((W - PAD.left - PAD.right) / HISTORY_DURATION_S);
    show(points.reduce((best, m) => (Math.abs(m.at - at) < Math.abs(best.at - at) ? m : best)));
  });
  hit.addEventListener("pointerleave", () => show(null));

  const legend = el("p", { class: "chart-legend" }, "Solid: average · dashed: gust (m/s)");
  return el("figure", { class: "wind-figure" }, legend, root, readout);
}
