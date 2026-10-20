// Rates today and the next two days for the given site ids, and sends the soarable ones to ntfy when NTFY_TOPIC is set: npm run check -- 9616 9654
import sitesData from "../src/data/sites.json";
import { memoryStore } from "../src/forecast/cache";
import { MODELS } from "../src/forecast/client";
import { loadForecasts } from "../src/forecast/overview";
import { alertFor, buildReports, formatReport, osloDays, sendAlert, type ModelResult } from "../src/report";
import type { Site } from "../src/types";

const DAYS = 3;

const ids = process.argv.slice(2);
const sites = (sitesData as Site[]).filter((s) => ids.includes(s.id));
const unknown = ids.filter((id) => !sites.some((s) => s.id === id));
if (ids.length === 0 || unknown.length) {
  console.error(ids.length ? `Unknown site ids: ${unknown.join(", ")}` : "Give one or more site ids.");
  process.exit(1);
}

const days = osloDays(Date.now(), DAYS);
const range = { start: days[0], end: days[days.length - 1] };
const store = memoryStore();
const results: ModelResult[] = await Promise.all(
  MODELS.map(async ({ id }) => {
    try {
      return { model: id, forecasts: await loadForecasts(sites, range, id, { store }) };
    } catch (err) {
      return { model: id, error: err instanceof Error ? err.message : String(err) };
    }
  }),
);
const reports = buildReports(sites, days, results);
console.log(formatReport(reports, results));
if (results.every((r) => "error" in r)) {
  console.error("No model answered, so nothing was checked.");
  process.exit(1);
}

const alert = alertFor(reports);
const topic = process.env.NTFY_TOPIC;
if (alert && topic) {
  await sendAlert(topic, alert);
  console.log(`\nSent to ntfy: ${alert.title}`);
}
