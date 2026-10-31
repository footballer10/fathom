import type {
  Category,
  DailyInfo,
  FinishResponse,
  GameMode,
  GuessResponse,
  RevealAnswer,
  RevealResponse,
  SessionState,
  TierPoints,
} from "@fathom/shared";
import { getPlayerId } from "./player";

/**
 * Thin client for the solo API. In Phase 1 these routes are served by the
 * local mock (web/mock); in Phase 3 the same routes come from the Worker.
 */

let clockOffset = 0;
/** Server time estimate, so countdowns line up with the server's deadline. */
export function serverNow(): number {
  return Date.now() + clockOffset;
}

/** Update the clock offset from a server timestamp (assumed taken halfway through the round trip). */
export function syncClock(serverTime: number, rttMs: number) {
  clockOffset = serverTime + rttMs / 2 - Date.now();
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const sentAt = Date.now();
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": getPlayerId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { code: data.code as string | undefined });
  if (typeof data.serverNow === "number") syncClock(data.serverNow, Date.now() - sentAt);
  return data as T;
}

export type DailyStatus = DailyInfo & { status: "new" | "in-progress" | "finished" };

export interface PlayerStats {
  played: number;
  currentStreak: number;
  bestStreak: number;
  averageDepth: number;
  bestDepth: number;
  histogram: Record<string, number>;
  recent: { date: string; points: number }[];
  unlimited?: { dives: number; answered: number; bestDepth: number; seen: number };
}

export interface LeaderboardBoard {
  id: string;
  title: string;
  description: string;
  unit: "count" | "meters" | "percent" | "days";
  rows: LeaderboardEntry[];
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  value: number;
  you: boolean;
  /** Public friend code, used to send a friend request. */
  code: string | null;
  friend: "friends" | "sent" | null;
}

export interface FriendRequest {
  nickname: string;
  code: string;
  at: number;
}

export type SuggestionKind = "answer" | "bug" | "idea" | "other";

export interface PracticeQuestion {
  id: string;
  prompt: string;
  category: Category;
  answerCount: number;
}

export interface PracticeGuess {
  accepted: boolean;
  answerId: string | null;
  canonical: string | null;
  tier: TierPoints | null;
  points: number;
  corrected: boolean;
  reason: string | null;
}

export interface AbyssAttempt {
  startedAt: number;
  endsAt: number;
  done: boolean;
  best: { tier: TierPoints; canonical: string } | null;
  answers: { answerId: string; canonical: string; tier: TierPoints }[];
}

export interface AbyssStatus {
  week: string;
  weekEndsAt: number;
  seconds: number;
  category: Category;
  prompt: string | null;
  attempt: AbyssAttempt | null;
  board: { divers: number; rows: { rank: number; nickname: string; tier: TierPoints; answer: string; you: boolean }[] };
}

export interface Profile {
  nickname: string | null;
  friendCode: string | null;
}

export interface LeaderboardRow {
  you: boolean;
  nickname: string;
  friendCode: string;
  depth: number | null;
  zone: string | null;
  tiers: (number | null)[] | null;
  weekDepth: number;
}

export const api = {
  daily: () => call<DailyStatus>("GET", "/api/daily"),
  categories: () => call<{ category: Category; count: number }[]>("GET", "/api/categories"),
  start: (mode: GameMode, category?: Category) => call<SessionState>("POST", "/api/session/start", { mode, category }),
  state: (id: string) => call<SessionState>("GET", `/api/session/${id}`),
  next: (id: string) => call<SessionState>("POST", `/api/session/${id}/next`),
  guess: (id: string, index: number, text: string) =>
    call<GuessResponse>("POST", `/api/session/${id}/guess`, { index, text }),
  reveal: (id: string, index: number) => call<RevealResponse>("GET", `/api/session/${id}/reveal/${index}`),
  finish: (id: string) => call<FinishResponse>("POST", `/api/session/${id}/finish`),
  stats: () => call<PlayerStats>("GET", "/api/stats/me"),
  report: (sessionId: string, index: number, guess: string) =>
    call<{ ok: true }>("POST", "/api/report", { sessionId, index, guess }),
  /** Party games: report by the prompt's text. */
  reportPrompt: (prompt: string, guess: string) => call<{ ok: true }>("POST", "/api/report", { prompt, guess }),
  profile: () => call<Profile>("GET", "/api/player"),
  setNickname: (nickname: string) => call<Profile>("POST", "/api/player", { nickname }),
  leaderboards: () => call<{ updatedAt: number; minAnswersForRates: number; boards: LeaderboardBoard[] }>("GET", "/api/leaderboards"),
  addFriend: (code: string) => call<{ ok: true; nickname: string | null }>("POST", "/api/friends", { code }),
  leaderboard: () =>
    call<{ date: string; dailyNumber: number; me: Profile; rows: LeaderboardRow[] }>("GET", "/api/friends/leaderboard"),
  archive: () => call<{ date: string; dailyNumber: number; depth: number | null }[]>("GET", "/api/archive"),
  startArchive: (date: string) => call<SessionState>("POST", "/api/session/start", { mode: "archive", date }),
  requestFriend: (code: string) => call<{ status: "sent" | "friends"; nickname: string | null }>("POST", "/api/friends/requests", { code }),
  friendRequests: () => call<{ requests: FriendRequest[] }>("GET", "/api/friends/requests"),
  answerRequest: (code: string, answer: "accept" | "decline") => call<{ ok: true }>("POST", `/api/friends/requests/${encodeURIComponent(code)}/${answer}`),
  practiceQuestion: (opts: { exclude?: string[]; minAnswers?: number; tier?: number } = {}) => call<PracticeQuestion>("POST", "/api/practice/question", opts),
  practiceGuess: (id: string, text: string, taken: string[] = []) => call<PracticeGuess>("POST", "/api/practice/guess", { id, text, taken }),
  practiceAnswers: (id: string) => call<{ answers: RevealAnswer[] }>("GET", `/api/practice/answers/${encodeURIComponent(id)}`),
  abyss: () => call<AbyssStatus>("GET", "/api/abyss"),
  abyssStart: () => call<{ prompt: string; category: Category; attempt: AbyssAttempt }>("POST", "/api/abyss/start"),
  abyssGuess: (text: string) => call<{ accepted: boolean; canonical: string | null; tier: TierPoints | null; points: number; reason: string | null }>("POST", "/api/abyss/guess", { text }),
  suggest: (kind: SuggestionKind, text: string) => call<{ ok: true }>("POST", "/api/suggestions", { kind, text }),
  createRoom: (kind: "dive" | "battle", variant?: string) => call<{ code: string }>("POST", "/api/rooms", { kind, variant }),
};
