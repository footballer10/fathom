import { APP_NAME, METERS_PER_POINT, MISS_EMOJI, tierInfo, zoneForDepth } from "./config";
import type { TierPoints } from "./config";

/** Format meters with thousands separators: 3650 → "3,650 m". */
export function formatDepth(meters: number): string {
  return `${Math.round(meters).toLocaleString("en-US")} m`;
}

export function pointsToDepth(points: number): number {
  return points * METERS_PER_POINT;
}

/**
 * Spoiler-free share text, e.g.
 *   Krillion Unlimited #42 — 3,650 m (Midnight Zone)
 *   🐟🐚🦐🦑🐚❌🐋
 */
export function shareCardText(opts: {
  dailyNumber: number | null;
  totalPoints: number;
  tiers: (TierPoints | null)[];
}): string {
  const depth = pointsToDepth(opts.totalPoints);
  const title = opts.dailyNumber !== null ? `${APP_NAME} #${opts.dailyNumber}` : `${APP_NAME} (Unlimited)`;
  const emoji = opts.tiers.map((t) => (t === null ? MISS_EMOJI : tierInfo(t).emoji)).join("");
  return `${title} — ${formatDepth(depth)} (${zoneForDepth(depth).name})\n${emoji}`;
}
