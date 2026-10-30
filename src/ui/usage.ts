import { DAILY_LIMIT } from "../usage";
import { el } from "./format";

// The meter turns yellow past half the limit and red past 80%.
const LOW_FRACTION = 0.5;
const HIGH_FRACTION = 0.8;

const count = (n: number) => n.toLocaleString("en-GB");

export function renderUsage(container: HTMLElement, sites: number): void {
  const meter = el("meter", {
    min: "0",
    max: String(DAILY_LIMIT),
    low: String(DAILY_LIMIT * LOW_FRACTION),
    high: String(DAILY_LIMIT * HIGH_FRACTION),
    optimum: "0",
    value: String(sites),
    "aria-label": "Open-Meteo requests today",
  });
  container.title = `Sites this browser has requested from Open-Meteo today, against the free limit of ${count(DAILY_LIMIT)} calls a day`;
  container.replaceChildren("Open-Meteo today ", meter, ` ${count(sites)} / ${count(DAILY_LIMIT)}`);
}
