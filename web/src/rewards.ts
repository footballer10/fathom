import { useSyncExternalStore } from "react";
import { DEFAULT_LOOK } from "@fathom/shared";
import type { Look, Quest, Slot } from "@fathom/shared";
import { getPlayerId } from "./player";

/**
 * Pearls, quests and your equipped look, shared by every screen.
 * Loaded once at start and refreshed after anything that can pay out.
 */

export type QuestView = Quest & { progress: number; claimed: boolean };

export interface RewardsStatus {
  pearls: number;
  lifetime: number;
  owned: string[];
  look: Look;
  daily: { date: string; quests: QuestView[] };
  weekly: { week: string; endsAt: number; quests: QuestView[] };
  streak: { current: number; best: number; playedToday: boolean; milestones: { days: number; pearls: number; items: string[]; reached: boolean; claimed: boolean }[] };
  achievements: { id: string; name: string; description: string; pearls: number; items: string[]; target: number; progress: number; claimed: boolean }[];
  recent: { label: string; pearls: number; at: number }[];
}

let status: RewardsStatus | null = null;
/** A pearl gain to show in the toast (set when the balance goes up). */
let gain: { amount: number; key: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(next: RewardsStatus, announce = true) {
  if (announce && status && next.pearls > status.pearls) gain = { amount: next.pearls - status.pearls, key: Date.now() };
  status = next;
  try {
    localStorage.setItem("fathom.look", JSON.stringify(next.look));
  } catch {
    /* fine */
  }
  emit();
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<RewardsStatus> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": getPlayerId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as RewardsStatus;
}

let inflight: Promise<void> | null = null;
/** Fetch the latest balance and quests (several callers at once share one request). */
export function refreshRewards(announce = true): Promise<void> {
  inflight ??= call("GET", "/api/rewards")
    .then((s) => set(s, announce))
    .catch(() => {})
    .finally(() => (inflight = null));
  return inflight;
}

/** Note pearls that the server already paid (e.g. shown on the end screen) without a second toast. */
export function quietRefresh() {
  return refreshRewards(false);
}

export async function claimReward(kind: "quest" | "achievement" | "streak", id: string) {
  set(await call("POST", "/api/rewards/claim", { kind, id }));
}

export async function buyItem(id: string) {
  set(await call("POST", "/api/shop/buy", { id }), false);
}

export async function equipItem(slot: Slot, id: string) {
  set(await call("POST", "/api/shop/equip", { slot, id }), false);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRewards(): RewardsStatus | null {
  return useSyncExternalStore(subscribe, () => status);
}

export function usePearlGain() {
  return useSyncExternalStore(subscribe, () => gain);
}

let savedLook: Look = (() => {
  try {
    return JSON.parse(localStorage.getItem("fathom.look") ?? "{}") as Look;
  } catch {
    return {};
  }
})();

/** Your equipped item in each slot (before the first load, whatever this device last saw). */
export function useMyLook(): Required<Look> {
  const s = useRewards();
  if (s) savedLook = s.look;
  return { ...DEFAULT_LOOK, ...savedLook } as Required<Look>;
}

/** How many quests and achievements are finished but not collected yet. */
export function readyToClaim(s: RewardsStatus | null): number {
  if (!s) return 0;
  const q = [...s.daily.quests, ...s.weekly.quests].filter((x) => !x.claimed && x.progress >= x.target).length;
  return q + s.achievements.filter((a) => !a.claimed && a.progress >= a.target).length + s.streak.milestones.filter((m) => m.reached && !m.claimed).length;
}

// ---------------------------------------------------------------------------
// Celebrations (shop "burst" items) when you land a rare answer
// ---------------------------------------------------------------------------

type CelebrateListener = (tier: number) => void;
const celebrateListeners = new Set<CelebrateListener>();

/** Play your equipped celebration for an answer of this tier (Rare and up only). */
export function celebrate(tier: number | null | undefined) {
  if (!tier || tier < 60) return;
  celebrateListeners.forEach((l) => l(tier));
}

export function onCelebrate(l: CelebrateListener) {
  celebrateListeners.add(l);
  return () => {
    celebrateListeners.delete(l);
  };
}
