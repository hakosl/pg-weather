import { LIMITS } from "../analysis/rating";
import { GLIDER_SINK_MS, SENSIBLE_HEAT_FRACTION } from "../analysis/thermals";
import type { FlyState } from "../types";
import { STATE_META, el } from "./format";

const ORDER: FlyState[] = ["soar", "fly", "marginal", "nogo", "nodata"];

export function renderLegend(container: HTMLElement): void {
  const items = ORDER.map((s) => {
    const dot = el("span", { class: "dot" });
    dot.style.background = STATE_META[s].color;
    return el("li", {}, dot, el("span", {}, el("strong", {}, STATE_META[s].label), ` ${STATE_META[s].meaning}`));
  });
  const L = LIMITS;
  const rules = [
    `Launch wind is the model's wind at launch height, taken from its pressure levels (MEPS: wind 10 m above its 2.5 km terrain).`,
    `Wind directions come from the club's zones on the launch's Holfuy station where there is one, else Paragliding Earth's ratings, else the terrain.`,
    `No-go: rain ≥ ${L.rainNoGo} mm/h, launch wind ≥ ${L.launchTooStrong} m/s, ≥ ${L.aboveTooStrong} m/s within ${L.aboveBandM} m above launch, gusts ≥ ${L.gustTooStrong} m/s, more than ${L.tailwindNoGo} m/s blowing down the slope from behind, or crosswind ≥ ${L.crossTooStrong} m/s.`,
    `Marginal: launch wind ${L.launchStrong}–${L.launchTooStrong} m/s, ${L.aboveStrong}–${L.aboveTooStrong} m/s just above, gusts ≥ ${L.gustStrong} m/s or ≥ ${L.gustFactor}× the mean, a marginal direction, crosswind, a light tailwind or low cloud.`,
    `Soarable: ${L.ridgeMin}–${L.ridgeMax} m/s blowing onto the slope, or moderate thermals reaching ${L.thermalMinAboveLaunchM} m above launch.`,
    `Thermal strength is w*, from how hard the ground heats the air (the model's own heat flux for ICON and GFS, ${SENSIBLE_HEAT_FRACTION * 100}% of the sunshine for ECMWF) and how deep the thermals go. Expected climb is w* less ${GLIDER_SINK_MS} m/s of glider sink. MEPS has no upper-air data, so no thermals.`,
    `On the map: whole day shows the best rating held for at least two daylight hours; pick an hour to see that hour, with arrows pointing downwind.`,
    `When a site isn't flyable, its tooltip and panel name what holds it back, with how many daylight hours each measure blocks.`,
  ];
  container.replaceChildren(
    el("summary", {}, el("span", {}, "Legend and rules"), el("span", { class: "legend-close", "aria-hidden": "true" }, "Close")),
    el("ul", {}, ...items),
    ...rules.map((r) => el("p", {}, r)),
  );
}
