import { APP_NAME, METERS_PER_POINT, MISS_EMOJI, tierInfo, zoneForDepth, DIVE_DEFAULTS } from "./config";
import type { TierPoints } from "./config";

/** Format meters with thousands separators: 3650 → "3,650 m". */
export function formatDepth(meters: number): string {
  return `${Math.round(meters).toLocaleString("en-US")} m`;
}

export function pointsToDepth(points: number): number {
  return points * METERS_PER_POINT;
}

/**
 * Party Dive: meters per point scale with the number of questions, so a
 * 3- or 15-question game reaches each zone as easily as a 7-question dive.
 */
export function partyDepthScale(questionCount: number): number {
  return DIVE_DEFAULTS.questionCount / Math.max(1, questionCount);
}

/** Depth for a Party Dive score, rounded to 10 m. */
export function partyDepth(points: number, questionCount: number): number {
  return Math.round((pointsToDepth(points) * partyDepthScale(questionCount)) / 10) * 10;
}

/**
 * Spoiler-free share text, e.g.
 *   Fathom #42 — 3,650 m (Midnight Zone)
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
