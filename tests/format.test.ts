import { describe, expect, it } from "vitest";
import type { Reason } from "../src/types";
import { sky } from "../src/ui/format";

const dark: Reason = { level: "nogo", text: "Dark", measure: "dark" };
const hour = (cloudCover: number | null, precipitation: number | null, reasons: Reason[] = []) => ({
  sample: { cloudCover, precipitation },
  reasons,
});

describe("sky", () => {
  it("shows rain first, even at night", () => {
    expect(sky(hour(100, 0.4, [dark]))?.label).toBe("Rain, 0.4 mm");
  });

  it("shows the moon for dark hours without rain", () => {
    expect(sky(hour(10, 0, [dark]))?.label).toBe("Dark");
  });

  it("keeps the sky at sunrise and sunset, which are only warnings", () => {
    expect(sky(hour(10, 0, [{ level: "warn", text: "Sunrise", measure: "dark" }]))?.label).toBe("Clear, 10% cloud");
  });

  it("grades cloud cover into clear, partly cloudy and overcast", () => {
    expect(sky(hour(25, 0))?.label).toBe("Clear, 25% cloud");
    expect(sky(hour(50, null))?.label).toBe("Partly cloudy, 50% cloud");
    expect(sky(hour(90, 0))?.label).toBe("Overcast, 90% cloud");
  });

  it("shows nothing without cloud cover", () => {
    expect(sky(hour(null, null))).toBeNull();
  });
});
