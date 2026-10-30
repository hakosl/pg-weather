import { describe, expect, it, vi } from "vitest";
import { USAGE_KEY, recordUsage, usageToday } from "../src/usage";

function fakeStorage(saved: Record<string, string> = {}) {
  const data = new Map(Object.entries(saved));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("usage", () => {
  it("adds up the sites requested during a day", () => {
    const storage = fakeStorage();
    expect(recordUsage(() => storage, "2026-10-30", 50)).toBe(50);
    expect(recordUsage(() => storage, "2026-10-30", 3)).toBe(53);
    expect(usageToday(() => storage, "2026-10-30")).toBe(53);
  });

  it("starts from zero on a new day", () => {
    const storage = fakeStorage({ [USAGE_KEY]: JSON.stringify({ day: "2026-10-29", sites: 900 }) });
    expect(usageToday(() => storage, "2026-10-30")).toBe(0);
    expect(recordUsage(() => storage, "2026-10-30", 4)).toBe(4);
  });

  it("reads junk as zero", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(usageToday(() => fakeStorage({ [USAGE_KEY]: "{not json" }), "2026-10-30")).toBe(0);
    expect(usageToday(() => fakeStorage({ [USAGE_KEY]: '{"day":"2026-10-30","sites":"lots"}' }), "2026-10-30")).toBe(0);
    warn.mockRestore();
  });

  it("still returns the total when storage is blocked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(recordUsage(blocked, "2026-10-30", 7)).toBe(7);
    warn.mockRestore();
  });
});
