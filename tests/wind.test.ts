import { describe, expect, it } from "vitest";
import { angleDiff, directionFit, maxWindBetween, ontoSlope, windAt } from "../src/analysis/wind";
import { hydnefossen, level, makeSite, sundvollen } from "./helpers";

describe("windAt", () => {
  it("interpolates wind components between levels, not speed and direction separately", () => {
    const w = windAt([level(500, 4, 350), level(1000, 4, 10)], 750);
    expect(w).not.toBeNull();
    expect(w!.speed).toBeCloseTo(4 * Math.cos((10 * Math.PI) / 180), 2);
    expect(angleDiff(w!.direction, 0)).toBeLessThan(0.5);
  });

  it("uses the nearest level outside the profile", () => {
    const levels = [level(500, 3, 90), level(1500, 9, 270)];
    expect(windAt(levels, 100)).toEqual({ speed: 3, direction: 90 });
    expect(windAt(levels, 3000)).toEqual({ speed: 9, direction: 270 });
  });

  it("skips levels without wind and returns null for an empty profile", () => {
    expect(windAt([level(500, null, 0), level(900, 6, 180)], 600)).toEqual({ speed: 6, direction: 180 });
    expect(windAt([], 600)).toBeNull();
  });
});

describe("maxWindBetween", () => {
  it("finds the strongest wind in the band, including the interpolated top", () => {
    const levels = [level(400, 3, 0), level(650, 9, 10), level(870, 12, 20)];
    const max = maxWindBetween(levels, 370, 870);
    expect(max!.wind.speed).toBeCloseTo(12, 5);
    expect(max!.heightM).toBe(870);
  });
});

describe("directionFit", () => {
  it("uses Paragliding Earth ratings when the site has them", () => {
    expect(directionFit(sundvollen, 0).fit).toBe("good");
    expect(directionFit(sundvollen, 45).fit).toBe("marginal");
    expect(directionFit(sundvollen, 225).fit).toBe("marginal");
    expect(directionFit(sundvollen, 135).fit).toBe("behind");
    expect(directionFit(sundvollen, 180).fit).toBe("behind");
  });

  it("takes the facing from the rated sectors", () => {
    expect(directionFit(sundvollen, 0).facing).toBeCloseTo(315, 0);
  });

  it("falls back to the terrain facing for unrated sites", () => {
    expect(directionFit(hydnefossen, 60).fit).toBe("good");
    expect(directionFit(hydnefossen, 110).fit).toBe("marginal");
    expect(directionFit(hydnefossen, 160).fit).toBe("cross");
    expect(directionFit(hydnefossen, 313).fit).toBe("behind");
  });

  it("reports unknown when there are no ratings and the terrain facing is unreliable", () => {
    const summit = makeSite({ ratings: null, aspectReliable: false });
    expect(directionFit(summit, 270)).toEqual({ fit: "unknown", facing: null, source: "none" });
  });
});

describe("ontoSlope", () => {
  it("is the wind component blowing onto the slope", () => {
    expect(ontoSlope({ speed: 5, direction: 315 }, 315)).toBeCloseTo(5);
    expect(ontoSlope({ speed: 5, direction: 0 }, 315)).toBeCloseTo(5 * Math.SQRT1_2);
    expect(ontoSlope({ speed: 5, direction: 135 }, 315)).toBeCloseTo(-5);
  });
});
