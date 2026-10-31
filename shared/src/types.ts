import type { Category, TierPoints } from "./config";

/** One valid answer as stored in content JSON. */
export interface AnswerData {
  text: string;
  aliases?: string[];
  tier: TierPoints;
}

/** A question as stored in content/questions/*.json. */
export interface QuestionData {
  id: string;
  prompt: string;
  category: Category;
  answers: AnswerData[];
  nearMisses?: string[];
  notes?: string;
}

/** "confirm" is never produced by the matcher: the server uses it to ask "Did you mean…?" before accepting an autocorrected guess. */
export type MatchReason = "wrong" | "taken" | "late" | "ambiguous" | "confirm";

export interface MatchResult {
  accepted: boolean;
  answerId: string | null;
  canonical: string | null;
  tier: TierPoints | null;
  points: number;
  /** True when a fuzzy / word-order step made the match (UI shows "Accepted as …"). */
  corrected: boolean;
  /** Only set when not accepted. Logged; the player just sees "Not accepted". */
  reason: MatchReason | null;
}

// ---------------------------------------------------------------------------
// Solo API shapes (shared by the mock API now and the Worker in Phase 3)
// ---------------------------------------------------------------------------

export type GameMode = "daily" | "unlimited" | "archive";

export interface QuestionPublic {
  index: number;
  questionId: string;
  prompt: string;
  category: Category;
  /** Epoch ms when this question's timer runs out (penalties already applied). */
  endsAt: number;
}

export interface PlayRecord {
  index: number;
  questionId: string;
  prompt: string;
  answerId: string | null;
  canonical: string | null;
  tier: TierPoints | null;
  points: number;
  corrected: boolean;
  msUsed: number;
}

export interface SessionState {
  sessionId: string;
  mode: GameMode;
  /** Daily number (#42) for daily mode, null for unlimited. */
  dailyNumber: number | null;
  date: string | null;
  total: number;
  plays: PlayRecord[];
  /** The question currently in progress (or just finished, awaiting "next"). */
  current: QuestionPublic | null;
  /** True once the current question is answered or timed out. */
  currentDone: boolean;
  finished: boolean;
  serverNow: number;
}

export interface GuessResponse extends MatchResult {
  endsAt: number;
  serverNow: number;
  /** True when this response ends the question (accepted or late). */
  questionDone: boolean;
}

export interface RevealAnswer {
  answerId: string;
  canonical: string;
  tier: TierPoints;
}

export interface RevealResponse {
  index: number;
  prompt: string;
  answers: RevealAnswer[];
  playerAnswerId: string | null;
}

export interface FinishResponse {
  mode: GameMode;
  dailyNumber: number | null;
  totalPoints: number;
  depth: number;
  zone: string;
  plays: PlayRecord[];
  /** Null until enough results exist (or always null in unlimited). */
  percentile: number | null;
  /** How many Daily dives the percentile is based on (including yours). */
  divers?: number | null;
  rarestToday: { prompt: string; canonical: string; tier: TierPoints } | null;
  /** Epoch ms of the next Daily reset. */
  nextDailyAt: number;
}

export interface DailyInfo {
  dailyNumber: number;
  date: string;
  prompts: { index: number; prompt: string; category: Category }[];
  nextDailyAt: number;
  serverNow: number;
}
