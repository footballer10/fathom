import { describe, expect, it } from "vitest";
import {
  dailyDateFor,
  dailyNumberFor,
  nextDailyResetAt,
  shareCardText,
  zoneForDepth,
  zonedMidnight,
} from "../src";

describe("daily reset clock (America/Denver)", () => {
  it("uses Mountain time for the date", () => {
    // 2026-11-02 05:30 UTC is still Nov 1 in Denver (UTC-7 after DST ends).
    expect(dailyDateFor(Date.UTC(2026, 10, 2, 5, 30))).toBe("2026-11-01");
    expect(dailyDateFor(Date.UTC(2026, 10, 2, 7, 30))).toBe("2026-11-02");
  });

  it("finds midnight in summer (MDT, UTC-6) and winter (MST, UTC-7)", () => {
    expect(new Date(zonedMidnight("2026-07-04")).toISOString()).toBe("2026-07-04T06:00:00.000Z");
    expect(new Date(zonedMidnight("2026-12-25")).toISOString()).toBe("2026-12-25T07:00:00.000Z");
  });

  it("handles the DST change day", () => {
    // DST ends Sunday 2026-11-01 at 2am; midnight that day is still MDT.
    expect(new Date(zonedMidnight("2026-11-01")).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(new Date(zonedMidnight("2026-11-02")).toISOString()).toBe("2026-11-02T07:00:00.000Z");
    const now = Date.UTC(2026, 10, 1, 18, 0);
    expect(new Date(nextDailyResetAt(now)).toISOString()).toBe("2026-11-02T07:00:00.000Z");
  });

  it("numbers Dailies from the epoch date", () => {
    expect(dailyNumberFor("2026-10-01")).toBe(1);
    expect(dailyNumberFor("2026-11-11")).toBe(42);
  });
});

describe("zones and share card", () => {
  it("rates depth by zone", () => {
    expect(zoneForDepth(0).name).toBe("Sunlight Zone");
    expect(zoneForDepth(999).name).toBe("Sunlight Zone");
    expect(zoneForDepth(1000).name).toBe("Twilight Zone");
    expect(zoneForDepth(3650).name).toBe("Midnight Zone");
    expect(zoneForDepth(4000).name).toBe("Abyssal Zone");
    expect(zoneForDepth(7000).name).toBe("Hadal Zone");
  });

  it("builds a spoiler-free share card", () => {
    expect(
      shareCardText({ dailyNumber: 42, totalPoints: 365, tiers: [30, 60, 10, 85, 60, null, 100] }),
    ).toBe("Krillion Unlimited #42 — 3,650 m (Midnight Zone)\n🐟🐚🦐🦑🐚❌🐋");
  });
});
