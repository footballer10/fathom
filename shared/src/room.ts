import type { Category, TierPoints } from "./config";
import type { RevealAnswer } from "./types";

/**
 * Party room protocol (JSON over WebSocket, a `type` field on every message).
 * Shared by the Durable Object, the web client and the simulation tests.
 */

export type RoomKind = "dive" | "battle";
export type QuestionSource = "daily" | "unlimited" | "category";

export interface DiveSettings {
  source: QuestionSource;
  category?: Category;
  questionCount: number;
  timerSeconds: number;
  uniqueAnswers: boolean;
}

export interface BattleSettings {
  source: QuestionSource;
  category?: Category;
  lives: number;
  baseSeconds: number;
  bonusScale: "off" | "normal" | "double";
  failedTurnsToRotate: number;
  /** null = 2 × alive players */
  acceptsToRotate: number | null;
  speedUp: boolean;
}

export type RoomPhase = "lobby" | "question" | "reveal" | "turn" | "rotate" | "over";

export interface RoomPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  /** Joined mid-game: watches until the next game. */
  spectator: boolean;
  score: number;
  timeUsedMs: number;
  lives: number;
  eliminated: boolean;
  locked: boolean;
}

export interface UsedAnswer {
  canonical: string;
  tier: TierPoints;
  byPlayerId: string;
}

export interface RevealRow {
  playerId: string;
  nickname: string;
  canonical: string | null;
  tier: TierPoints | null;
  points: number;
  corrected: boolean;
  shared: boolean;
}

export interface LeaderboardRow {
  playerId: string;
  nickname: string;
  score: number;
  timeUsedMs: number;
  rank: number;
  previousRank: number;
}

export interface GameResult {
  playerId: string;
  nickname: string;
  score: number;
  depth: number;
  timeUsedMs: number;
  rank: number;
  /** Per-question depth after each question, for the finale race animation (Dive). */
  depthTrail: number[];
  eliminatedAt?: number;
}

export interface RoomSnapshot {
  code: string;
  kind: RoomKind;
  hostId: string | null;
  phase: RoomPhase;
  players: RoomPlayer[];
  settings: DiveSettings | BattleSettings;
  you: string;
  serverNow: number;
  dive?: {
    index: number;
    total: number;
    prompt: string;
    category: Category;
    endsAt: number;
    yourEndsAt: number;
    yourAnswer: { canonical: string; tier: TierPoints; points: number; corrected: boolean } | null;
    reveal: { perPlayer: RevealRow[]; leaderboard: LeaderboardRow[]; answers: RevealAnswer[]; nextAt: number } | null;
  };
  battle?: {
    prompt: string;
    category: Category;
    round: number;
    baseSeconds: number;
    turnPlayerId: string | null;
    turnEndsAt: number;
    used: UsedAnswer[];
    typing: string;
    spectatorGuesses: { playerId: string; nickname: string; text: string; canonical: string | null; tier: TierPoints | null }[];
  };
  results?: { results: GameResult[]; bestAnswer: BestAnswer };
}

export type BestAnswer = { nickname: string; canonical: string; tier: TierPoints; prompt: string } | null;

// Client → server
export type ClientMessage =
  | { type: "join"; playerId: string; nickname: string }
  | { type: "settings"; settings: Partial<DiveSettings & BattleSettings> }
  | { type: "start" }
  | { type: "next" }
  | { type: "lobby" }
  | { type: "guess"; text: string }
  | { type: "typing"; text: string }
  | { type: "ping"; t: number };

// Server → client
export type ServerMessage =
  | { type: "state"; state: RoomSnapshot }
  | { type: "pong"; t: number; serverNow: number }
  | { type: "question"; index: number; total: number; prompt: string; category: Category; endsAt: number }
  | { type: "locked"; playerId: string }
  | {
      type: "guessResult";
      accepted: boolean;
      canonical: string | null;
      tier: TierPoints | null;
      points: number;
      corrected: boolean;
      reason: string | null;
      endsAt: number;
    }
  | { type: "reveal"; index: number; perPlayer: RevealRow[]; leaderboard: LeaderboardRow[]; answers: RevealAnswer[]; nextAt: number }
  | { type: "turn"; playerId: string; endsAt: number; prompt: string; seconds: number }
  | { type: "typing"; playerId: string; text: string }
  | { type: "taken"; answerCanonical: string; byPlayerId: string }
  | { type: "turnResult"; playerId: string; canonical: string; tier: TierPoints; corrected: boolean }
  | { type: "lifeLost"; playerId: string; livesLeft: number }
  | { type: "eliminated"; playerId: string }
  | { type: "rotate"; prompt: string; category: Category; baseSeconds: number; startsAt: number }
  | { type: "spectatorGuess"; playerId: string; nickname: string; text: string; canonical: string | null; tier: TierPoints | null }
  | { type: "gameOver"; results: GameResult[]; bestAnswer: BestAnswer }
  | { type: "error"; message: string };

export function isRoomCode(code: string): boolean {
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(code);
}
