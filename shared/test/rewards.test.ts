import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, DEFAULT_LOOK, ITEMS, ITEM_BY_ID, SKIN_STYLES, STREAK_MILESTONES, cleanLook, dailyQuests, ownsItem, weeklyQuests } from "../src/rewards";

describe("rewards catalog", () => {
  it("has unique item ids, and every default is a free item in its slot", () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const [slot, id] of Object.entries(DEFAULT_LOOK)) {
      expect(ITEM_BY_ID.get(id)?.slot).toBe(slot);
      expect(ITEM_BY_ID.get(id)?.price).toBe(0);
    }
  });

  it("draws every submarine, and every earn-only item says how to earn it and is actually given out", () => {
    for (const i of ITEMS.filter((x) => x.slot === "skin")) expect(SKIN_STYLES[i.id], i.id).toBeTruthy();
    const given = new Set([...STREAK_MILESTONES.flatMap((m) => m.items), ...ACHIEVEMENTS.flatMap((a) => a.items)]);
    for (const i of ITEMS.filter((x) => x.price === null)) {
      expect(i.unlock, i.id).toBeTruthy();
      expect(given.has(i.id), i.id).toBe(true);
    }
    for (const id of given) expect(ITEM_BY_ID.get(id)?.price, id).toBeNull();
  });

  it("picks the same quests for everyone on a day, never two on the same thing", () => {
    const a = dailyQuests("2026-11-05");
    expect(a.map((q) => q.id)).toEqual(dailyQuests("2026-11-05").map((q) => q.id));
    expect(a[0].id).toBe("d.daily");
    expect(new Set(a.map((q) => q.metric)).size).toBe(3);
    const w = weeklyQuests("2026-11-02");
    expect(w).toHaveLength(3);
    expect(new Set(w.map((q) => q.metric)).size).toBe(3);
  });

  it("only keeps equipped items you own, in the right slot", () => {
    expect(ownsItem([], "skin.classic")).toBe(true);
    expect(ownsItem([], "skin.coral")).toBe(false);
    expect(cleanLook({ skin: "skin.coral", trail: "skin.kelp", title: "title.legend", color: "color.gold" }, ["skin.coral", "color.gold"])).toEqual({
      skin: "skin.coral",
      color: "color.gold",
    });
    expect(cleanLook("nonsense", [])).toEqual({});
  });
});
