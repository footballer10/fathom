/**
 * Game-wide configuration. Everything you might want to tune lives here,
 * and the web app, worker, and scripts all read from this one file.
 */

export const APP_NAME = "Fathom";

/** The Daily set resets at midnight in this time zone (DST is handled automatically). */
export const DAILY_RESET_TZ = "America/Denver";

/**
 * Fallback for Daily numbering. The live site numbers Dailies from the first
 * day it actually served one (its launch day is #1); this date is only used
 * before any Daily exists.
 */
export const DAILY_EPOCH_DATE = "2026-10-01";

export const QUESTIONS_PER_DAY = 7;
export const QUESTIONS_PER_UNLIMITED_RUN = 7;

/** Every point earned sinks the diver this many meters. */
export const METERS_PER_POINT = 10;

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export type TierPoints = 10 | 15 | 30 | 60 | 85 | 100;

export interface TierInfo {
  points: TierPoints;
  name: string;
  emoji: string;
  /** Accent color used on reveal cards and the reveal panel. */
  color: string;
  /** Battle: how much of the life circle this answer fills, in 32nds. A full circle (32) is one extra life. */
  battleLifeFill: number;
}

/** Ordered from rarest to most common. */
export const TIERS: readonly TierInfo[] = [
  { points: 100, name: "One in a Krillion", emoji: "🐋", color: "#ffd166", battleLifeFill: 12 },
  { points: 85, name: "Deep Cut", emoji: "🦑", color: "#c77dff", battleLifeFill: 6 },
  { points: 60, name: "Rare", emoji: "🐚", color: "#ff8fab", battleLifeFill: 3 },
  { points: 30, name: "Schooler", emoji: "🐟", color: "#4cc9f0", battleLifeFill: 1 },
  { points: 15, name: "Too Clever", emoji: "🎣", color: "#90be6d", battleLifeFill: 1 },
  { points: 10, name: "Plankton", emoji: "🦐", color: "#a8dadc", battleLifeFill: 0 },
];

export const MISS_EMOJI = "❌";

export function tierInfo(points: TierPoints): TierInfo {
  const t = TIERS.find((x) => x.points === points);
  if (!t) throw new Error(`Unknown tier: ${points}`);
  return t;
}

// ---------------------------------------------------------------------------
// Timers (solo modes)
// ---------------------------------------------------------------------------

export const QUESTION_SECONDS = 25;
/** Solo (Daily and Unlimited) wrong guesses cost no time. Party hosts pick their own penalty. */
export const WRONG_GUESS_PENALTY_SECONDS = 0;
/** Extra time the server allows for network lag before calling a guess late. */
export const DEADLINE_GRACE_MS = 250;
/** The timer ring turns red below this many seconds. */
export const TIMER_WARNING_SECONDS = 5;

// ---------------------------------------------------------------------------
// End-of-dive zones (depth thresholds in meters; tune after playtesting)
// ---------------------------------------------------------------------------

export interface ZoneInfo {
  name: string;
  /** Minimum depth in meters to reach this zone. */
  minDepth: number;
}

export const ZONES: readonly ZoneInfo[] = [
  { name: "Sunlight Zone", minDepth: 0 },
  { name: "Twilight Zone", minDepth: 1000 },
  { name: "Midnight Zone", minDepth: 2500 },
  { name: "Abyssal Zone", minDepth: 4000 },
  { name: "Hadal Zone", minDepth: 5500 },
];

export function zoneForDepth(depthMeters: number): ZoneInfo {
  let zone = ZONES[0];
  for (const z of ZONES) if (depthMeters >= z.minDepth) zone = z;
  return zone;
}

/** Hide the "deeper than X% of today's divers" line until this many results exist. */
/** Daily dives needed before the results curve (and percentile) appear. */
export const PERCENTILE_MIN_RESULTS = 20;

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

/**
 * How the fuzzy step treats a guess that is within the typo threshold of
 * more than one valid answer:
 *  - "unique-closest": accept only if one answer is strictly closer than all others
 *    (e.g. "austrlia" → Australia, but a guess equally close to Austria and Australia is rejected)
 *  - "strict": reject whenever more than one answer is within the threshold
 */
export const MATCHER_AMBIGUITY: "unique-closest" | "strict" = "unique-closest";

// ---------------------------------------------------------------------------
// Unlimited / content pipeline
// ---------------------------------------------------------------------------


/**
 * Weekly content plan: 49 new Daily questions (7 days × 7) plus 100 extra
 * Unlimited questions. Every Daily joins Unlimited the day after it airs, so
 * the Unlimited pool grows by about 149 questions a week.
 *
 * The pool is capped at 2,000 active questions (reached after roughly 13
 * weeks). A player doing several runs a day would need about two months to
 * see 80% of it, so repeats stay rare. Past the cap, `npm run pool:refresh`
 * retires the oldest, most-played questions (kept, never deleted) and rotates
 * them back in later. Raise this number any time; D1's free tier can hold far more.
 */
export const UNLIMITED_POOL_CAP = 2000;
export const WEEKLY_UNLIMITED_QUESTIONS = 100;
export const SCHEDULE_BUFFER_DAYS = 14;

export const CATEGORIES = [
  "food",
  "animals",
  "geography",
  "sports",
  "music",
  "movies-tv",
  "words-language",
  "science",
  "brands",
  "everyday-objects",
  "history",
  "games-toys",
  "jobs-people",
  "body-health",
  "vehicles",
  "nature",
] as const;

export type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Party: Dive defaults (Phase 5)
// ---------------------------------------------------------------------------

export const ROOM_CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const DIVE_DEFAULTS = {
  maxPlayers: 16,
  questionCount: 7,
  questionCountMin: 3,
  questionCountMax: 15,
  timerOptions: [15, 25, 40, 60],
  timerSeconds: 25,
  uniqueAnswers: false,
  wrongGuessPenaltySeconds: 2,
  /** Host slider range for the wrong-guess penalty, in seconds. */
  penaltyMax: 5,
  /** School of Fish: points for each other diver who gave the same answer as you. */
  schoolPointsPerMatch: 25,
  /** Shark Tank: how many bites a diver can take (host slider). */
  sharkLives: 1,
  sharkLivesMax: 5,
  /** Co-op: target points per player per question (about a Rare-ish average). */
  coopPointsPerAnswer: 40,
  /** How long the per-question reveal stays up before the next question. */
  revealSeconds: 9,
  roomIdleExpiryMinutes: 120,
} as const;

// ---------------------------------------------------------------------------
// Party: Battle defaults (Phase 6)
// ---------------------------------------------------------------------------

export const BATTLE_DEFAULTS = {
  maxPlayers: 12,
  lives: 3,
  livesMin: 1,
  livesMax: 5,
  baseSeconds: 10,
  baseSecondsMin: 6,
  baseSecondsMax: 20,
  minBaseSeconds: 4,
  wrongGuessPenaltySeconds: 1,
  penaltyMax: 5,
  /** Size of the life circle in 32nds; filling it earns one life. */
  lifeMeterFull: 32,
  failedTurnsToRotate: 2,
  minUnusedAnswersBeforeRotate: 5,
  speedUp: false,
  typingUpdatesPerSecond: 10,
  /** Pause between turns, and the "NEW PROMPT" transition length. */
  betweenTurnsMs: 1200,
  rotatePauseMs: 2500,
  /** Hot Potato: the shorter pause between turns, since every turn brings a new prompt. */
  hotPotatoPauseMs: 1500,
  minPlayers: 2,
} as const;
