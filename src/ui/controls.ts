import { MODELS, type DayRange } from "../forecast/client";
import type { ModelId } from "../types";
import { el, pad2 } from "./format";

export interface Selection {
  day: string;
  hour: number | null;
  model: ModelId;
}

const FORECAST_DAYS = 5;
const MODEL_KEY = "pg-weather:model";
const DEFAULT_MODEL: ModelId = "icon_seamless";

export const osloDate = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(d);

export function upcomingDays(now = new Date()): { day: string; label: string }[] {
  return Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = new Date(now.getTime() + i * 86_400_000);
    const day = osloDate(date);
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "Europe/Oslo" }).format(date);
    return { day, label };
  });
}

export function dayRange(now = new Date()): DayRange {
  const days = upcomingDays(now);
  return { start: days[0].day, end: days[days.length - 1].day };
}

function savedModel(): ModelId {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    if (MODELS.some((x) => x.id === m)) return m as ModelId;
  } catch {
    // Fall back to the default model.
  }
  return DEFAULT_MODEL;
}

export function setupControls(onChange: (s: Selection) => void): { selection: () => Selection; setHour: (h: number | null) => void } {
  const daysNav = document.getElementById("days")!;
  const hourInput = document.getElementById("hour") as HTMLInputElement;
  const hourLabel = document.getElementById("hour-label") as HTMLOutputElement;
  const wholeDay = document.getElementById("whole-day") as HTMLButtonElement;
  const modelSelect = document.getElementById("model") as HTMLSelectElement;

  const days = upcomingDays();
  const sel: Selection = { day: days[0].day, hour: null, model: savedModel() };

  const dayButtons = days.map((d) => {
    const b = el("button", { type: "button", class: "chip", "aria-pressed": String(d.day === sel.day) }, d.label);
    b.addEventListener("click", () => {
      sel.day = d.day;
      dayButtons.forEach((x, i) => x.setAttribute("aria-pressed", String(days[i].day === sel.day)));
      onChange({ ...sel });
    });
    return b;
  });
  daysNav.replaceChildren(...dayButtons);

  for (const m of MODELS) modelSelect.append(el("option", { value: m.id, title: m.detail }, m.label));
  modelSelect.value = sel.model;
  modelSelect.addEventListener("change", () => {
    sel.model = modelSelect.value as ModelId;
    try {
      localStorage.setItem(MODEL_KEY, sel.model);
    } catch {
      // Not remembering the model is harmless.
    }
    onChange({ ...sel });
  });

  const render = () => {
    wholeDay.setAttribute("aria-pressed", String(sel.hour == null));
    hourLabel.value = sel.hour == null ? "best" : `${pad2(sel.hour)}:00`;
    if (sel.hour != null) hourInput.value = String(sel.hour);
  };
  const setHour = (h: number | null) => {
    sel.hour = h;
    render();
  };
  hourInput.addEventListener("input", () => {
    setHour(Number(hourInput.value));
    onChange({ ...sel });
  });
  wholeDay.addEventListener("click", () => {
    setHour(null);
    onChange({ ...sel });
  });
  render();

  return { selection: () => ({ ...sel }), setHour };
}
