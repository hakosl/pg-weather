import type { SiteDay } from "../forecast/overview";
import type { Site } from "../types";
import { HOURS, STATE_META, el, hourOf, pad2, pill, ratingNote, sky, slotAt, stateAt } from "./format";

interface Handlers {
  onOpen: (site: Site) => void;
  onRemove: (site: Site) => void;
}

function hourCells(day: SiteDay | undefined, hour: number | null): HTMLElement {
  const cells = HOURS.map((h) => {
    const state = day?.hours.find((r) => hourOf(r.time) === h)?.state ?? "nodata";
    const cell = el("span", { class: h === hour ? "selected" : "" });
    cell.style.background = STATE_META[state].color;
    return cell;
  });
  return el("span", { class: "cells fav-hours", "aria-hidden": "true" }, ...cells);
}

function skyCells(day: SiteDay): HTMLElement {
  const icons = HOURS.map((h) => {
    const r = slotAt(day, h);
    return el("span", {}, r ? sky(r)?.icon ?? "" : "");
  });
  return el("span", { class: "cells fav-sky", "aria-hidden": "true" }, ...icons);
}

function row(site: Site, day: SiteDay | undefined, hour: number | null, handlers: Handlers): HTMLElement {
  const slot = day ? slotAt(day, hour) : null;
  const summary = day
    ? el("span", { class: "fav-summary" }, pill(stateAt(day, slot)), el("span", { class: "muted" }, ratingNote(day, slot)))
    : el("span", { class: "fav-summary muted" }, "Not rated yet");
  const open = el("button", { type: "button", class: "fav-open" }, el("span", { class: "fav-name" }, site.name), summary, day ? skyCells(day) : null, hourCells(day, hour));
  open.addEventListener("click", () => handlers.onOpen(site));
  const remove = el("button", { type: "button", class: "fav-remove", "aria-label": `Remove ${site.name} from favorites`, title: "Remove from favorites" }, "★");
  remove.addEventListener("click", () => handlers.onRemove(site));
  return el("li", { class: "fav-item" }, open, remove);
}

/** Favorite sites with the selected model's day, hour by hour, in the order they were added. */
export function renderFavorites(container: HTMLElement, sites: Site[], ratings: Map<string, SiteDay>, hour: number | null, handlers: Handlers): void {
  const title = el("h2", {}, "Favorites");
  if (sites.length === 0) {
    container.replaceChildren(
      el("div", { class: "fav-list" }, title, el("p", { class: "muted" }, "No favorites yet. Open a site on the map and tap ☆ Favorite in its panel to keep it here.")),
    );
    return;
  }
  const axis = el("div", { class: "fav-axis", "aria-hidden": "true" }, el("div", { class: "cells" }, ...HOURS.map((h) => el("span", {}, h % 3 === 0 ? pad2(h) : ""))));
  const items = sites.map((s) => row(s, ratings.get(s.id), hour, handlers));
  container.replaceChildren(el("div", { class: "fav-list" }, title, axis, el("ul", {}, ...items)));
}
