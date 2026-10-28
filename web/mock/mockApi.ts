/**
 * Phase 1 local mock API.
 *
 * Runs inside the Vite dev/preview server (see vitePlugin.ts) so answer lists
 * stay on the "server" side, just like the real Cloudflare Worker in Phase 3.
 * State lives in memory: restarting `npm run dev` resets sessions and results.
 *
 * Imports use relative paths (not "@krillion/shared") because Vite bundles
 * this file together with vite.config.ts, and Node can't load .ts packages.
 */
import rawQuestions from "../../content/questions/phase1-mock.json";
import {
  DEADLINE_GRACE_MS,
  PERCENTILE_MIN_RESULTS,
  QUESTIONS_PER_DAY,
  QUESTIONS_PER_UNLIMITED_RUN,
  QUESTION_SECONDS,
  UNLIMITED_REPEAT_THRESHOLD,
  WRONG_GUESS_PENALTY_SECONDS,
  buildIndex,
  dailyDateFor,
  dailyNumberFor,
  matchGuess,
  nextDailyResetAt,
  pointsToDepth,
  zoneForDepth,
} from "../../shared/src/index";
import type {
  AnswerIndex,
  Category,
  DailyInfo,
  FinishResponse,
  GameMode,
  GuessResponse,
  PlayRecord,
  QuestionData,
  RevealResponse,
  SessionState,
  TierPoints,
} from "../../shared/src/index";

const QUESTIONS = rawQuestions as QuestionData[];
const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));
// Precompile every answer index once, as the Worker will cache them from KV.
const INDEXES = new Map<string, AnswerIndex>(QUESTIONS.map((q) => [q.id, buildIndex(q)]));

// ---------------------------------------------------------------------------
// In-memory "database"
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  playerId: string;
  mode: GameMode;
  date: string | null;
  questionIds: string[];
  /** -1 until the first question starts. */
  currentIndex: number;
  questionStartedAt: number;
  /** Wrong guesses on the current question (each one costs time). */
  penalties: number;
  currentDone: boolean;
  plays: PlayRecord[];
  finished: boolean;
}

interface DailyResult {
  playerId: string;
  date: string;
  points: number;
}

const sessions = new Map<string, Session>();
/** `${playerId}|${date}` → session id, so a refresh resumes the same Daily. */
const dailySessionByPlayer = new Map<string, string>();
const dailyResults: DailyResult[] = [];
/** Every accepted Daily answer, for "rarest answer anyone gave today". */
const dailyAnswers: { date: string; prompt: string; canonical: string; tier: TierPoints }[] = [];
const seenByPlayer = new Map<string, Set<string>>();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Question selection
// ---------------------------------------------------------------------------

/** Small deterministic PRNG so everyone gets the same Daily for a date. */
function seededRandom(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The mock "schedule": a deterministic pick of 7 questions per date.
 * (Phase 3 replaces this with real scheduled sets from D1.)
 */
function dailySetFor(date: string): string[] {
  return shuffle(
    QUESTIONS.map((q) => q.id),
    seededRandom(date),
  ).slice(0, QUESTIONS_PER_DAY);
}

/** Unlimited never serves today's Daily questions. */
function unlimitedPool(today: string, category?: Category): string[] {
  const daily = new Set(dailySetFor(today));
  return QUESTIONS.filter((q) => !daily.has(q.id) && (!category || q.category === category)).map((q) => q.id);
}

function pickUnlimited(playerId: string, today: string, category?: Category): string[] {
  const pool = unlimitedPool(today, category);
  let seen = seenByPlayer.get(playerId);
  if (!seen) seenByPlayer.set(playerId, (seen = new Set()));
  const seenInPool = pool.filter((id) => seen.has(id)).length;
  // Once the player has seen 80% of the pool, start the cycle over.
  if (pool.length > 0 && seenInPool / pool.length >= UNLIMITED_REPEAT_THRESHOLD) {
    for (const id of pool) seen.delete(id);
  }
  const unseen = shuffle(pool.filter((id) => !seen.has(id)));
  const seenOnes = shuffle(pool.filter((id) => seen.has(id)));
  const picked = [...unseen, ...seenOnes].slice(0, QUESTIONS_PER_UNLIMITED_RUN);
  for (const id of picked) seen.add(id);
  return picked;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function endsAt(s: Session): number {
  return s.questionStartedAt + QUESTION_SECONDS * 1000 - s.penalties * WRONG_GUESS_PENALTY_SECONDS * 1000;
}

/** If the current question's clock ran out, record it as a miss. */
function settle(s: Session, now: number) {
  if (s.currentIndex < 0 || s.currentDone) return;
  if (now > endsAt(s) + DEADLINE_GRACE_MS) {
    const q = BY_ID.get(s.questionIds[s.currentIndex])!;
    s.plays.push({
      index: s.currentIndex,
      questionId: q.id,
      prompt: q.prompt,
      answerId: null,
      canonical: null,
      tier: null,
      points: 0,
      corrected: false,
      msUsed: QUESTION_SECONDS * 1000,
    });
    s.currentDone = true;
  }
}

function getSession(id: string, playerId: string): Session {
  const s = sessions.get(id);
  if (!s || s.playerId !== playerId) throw new HttpError(404, "Session not found");
  return s;
}

function toState(s: Session, now: number): SessionState {
  settle(s, now);
  const q = s.currentIndex >= 0 ? BY_ID.get(s.questionIds[s.currentIndex]) : undefined;
  return {
    sessionId: s.id,
    mode: s.mode,
    dailyNumber: s.date ? dailyNumberFor(s.date) : null,
    date: s.date,
    total: s.questionIds.length,
    plays: s.plays,
    current: q
      ? { index: s.currentIndex, questionId: q.id, prompt: q.prompt, category: q.category, endsAt: endsAt(s) }
      : null,
    currentDone: s.currentDone,
    finished: s.finished,
    serverNow: now,
  };
}

function totalPoints(s: Session) {
  return s.plays.reduce((n, p) => n + p.points, 0);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function getDaily(playerId: string, now: number): DailyInfo & { status: "new" | "in-progress" | "finished" } {
  const date = dailyDateFor(now);
  const ids = dailySetFor(date);
  const sid = dailySessionByPlayer.get(`${playerId}|${date}`);
  const s = sid ? sessions.get(sid) : undefined;
  return {
    dailyNumber: dailyNumberFor(date),
    date,
    prompts: ids.map((id, index) => {
      const q = BY_ID.get(id)!;
      return { index, prompt: q.prompt, category: q.category };
    }),
    nextDailyAt: nextDailyResetAt(now),
    serverNow: now,
    status: !s ? "new" : s.finished ? "finished" : "in-progress",
  };
}

function startSession(playerId: string, body: { mode?: GameMode; category?: Category }, now: number) {
  const mode = body.mode === "unlimited" ? "unlimited" : "daily";
  const today = dailyDateFor(now);

  if (mode === "daily") {
    // One scored attempt per player per day: resume (or show results of) the existing one.
    const existing = dailySessionByPlayer.get(`${playerId}|${today}`);
    if (existing) return toState(sessions.get(existing)!, now);
  }

  const questionIds = mode === "daily" ? dailySetFor(today) : pickUnlimited(playerId, today, body.category);
  if (questionIds.length === 0) throw new HttpError(400, "No questions available for that category");

  const s: Session = {
    id: crypto.randomUUID(),
    playerId,
    mode,
    date: mode === "daily" ? today : null,
    questionIds,
    currentIndex: -1,
    questionStartedAt: 0,
    penalties: 0,
    currentDone: false,
    plays: [],
    finished: false,
  };
  sessions.set(s.id, s);
  if (mode === "daily") dailySessionByPlayer.set(`${playerId}|${today}`, s.id);
  return toState(s, now);
}

function nextQuestion(s: Session, now: number) {
  settle(s, now);
  // Still mid-question (e.g. a double click or a refresh): just return it.
  if (s.currentIndex >= 0 && !s.currentDone) return toState(s, now);
  if (s.currentIndex + 1 >= s.questionIds.length) throw new HttpError(409, "No more questions");
  s.currentIndex += 1;
  s.questionStartedAt = now;
  s.penalties = 0;
  s.currentDone = false;
  return toState(s, now);
}

function guess(s: Session, body: { index?: number; text?: string }, now: number): GuessResponse {
  settle(s, now);
  const base = { serverNow: now };
  if (body.index !== s.currentIndex || s.currentDone) {
    return {
      ...base,
      accepted: false,
      answerId: null,
      canonical: null,
      tier: null,
      points: 0,
      corrected: false,
      reason: "late",
      endsAt: endsAt(s),
      questionDone: true,
    };
  }
  const qid = s.questionIds[s.currentIndex];
  const q = BY_ID.get(qid)!;
  const result = matchGuess(INDEXES.get(qid)!, String(body.text ?? "").slice(0, 100));

  if (result.accepted) {
    s.plays.push({
      index: s.currentIndex,
      questionId: qid,
      prompt: q.prompt,
      answerId: result.answerId,
      canonical: result.canonical,
      tier: result.tier,
      points: result.points,
      corrected: result.corrected,
      msUsed: Math.min(now - s.questionStartedAt, QUESTION_SECONDS * 1000),
    });
    s.currentDone = true;
    if (s.mode === "daily" && s.date && result.canonical && result.tier) {
      dailyAnswers.push({ date: s.date, prompt: q.prompt, canonical: result.canonical, tier: result.tier });
    }
    return { ...result, ...base, endsAt: endsAt(s), questionDone: true };
  }

  // Wrong guess: the clock loses a couple of seconds, and the player keeps guessing.
  s.penalties += 1;
  settle(s, now);
  return { ...result, ...base, endsAt: endsAt(s), questionDone: s.currentDone };
}

function reveal(s: Session, index: number, now: number): RevealResponse {
  settle(s, now);
  const finished = index < s.currentIndex || (index === s.currentIndex && s.currentDone);
  if (!finished) throw new HttpError(403, "Answers are revealed once the question is over");
  const q = BY_ID.get(s.questionIds[index])!;
  const index_ = INDEXES.get(q.id)!;
  return {
    index,
    prompt: q.prompt,
    answers: index_.answers.map((a) => ({ answerId: a.id, canonical: a.canonical, tier: a.tier })),
    playerAnswerId: s.plays.find((p) => p.index === index)?.answerId ?? null,
  };
}

function finish(s: Session, now: number): FinishResponse {
  settle(s, now);
  const allDone = s.currentIndex === s.questionIds.length - 1 && s.currentDone;
  if (!allDone && !s.finished) throw new HttpError(409, "The dive isn't over yet");
  const points = totalPoints(s);

  if (!s.finished) {
    s.finished = true;
    if (s.mode === "daily" && s.date) dailyResults.push({ playerId: s.playerId, date: s.date, points });
  }

  let percentile: number | null = null;
  let rarest: FinishResponse["rarestToday"] = null;
  if (s.mode === "daily" && s.date) {
    const today = dailyResults.filter((r) => r.date === s.date);
    if (today.length >= PERCENTILE_MIN_RESULTS) {
      const others = today.filter((r) => r.playerId !== s.playerId);
      const shallower = others.filter((r) => r.points < points).length;
      percentile = others.length ? Math.round((shallower / others.length) * 100) : null;
    }
    for (const a of dailyAnswers) {
      if (a.date === s.date && (!rarest || a.tier > rarest.tier)) rarest = a;
    }
  } else {
    // Unlimited: the rarest answer from this run.
    for (const p of s.plays) {
      if (p.tier && p.canonical && (!rarest || p.tier > rarest.tier)) {
        rarest = { prompt: p.prompt, canonical: p.canonical, tier: p.tier };
      }
    }
  }
  if (rarest) rarest = { prompt: rarest.prompt, canonical: rarest.canonical, tier: rarest.tier };

  const depth = pointsToDepth(points);
  return {
    mode: s.mode,
    dailyNumber: s.date ? dailyNumberFor(s.date) : null,
    totalPoints: points,
    depth,
    zone: zoneForDepth(depth).name,
    plays: s.plays,
    percentile,
    rarestToday: rarest,
    nextDailyAt: nextDailyResetAt(now),
  };
}

function categories(now: number) {
  const pool = unlimitedPool(dailyDateFor(now));
  const counts = new Map<string, number>();
  for (const id of pool) {
    const c = BY_ID.get(id)!.category;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function handleApi(method: string, path: string, playerId: string, body: any): unknown {
  const now = Date.now();
  if (!playerId) throw new HttpError(400, "Missing player id");

  if (method === "GET" && path === "/api/daily") return getDaily(playerId, now);
  if (method === "GET" && path === "/api/categories") return categories(now);
  if (method === "POST" && path === "/api/session/start") return startSession(playerId, body ?? {}, now);

  const m = path.match(/^\/api\/session\/([\w-]+)(?:\/(\w+))?(?:\/(\d+))?$/);
  if (m) {
    const [, id, action, arg] = m;
    const s = getSession(id, playerId);
    if (method === "GET" && !action) return toState(s, now);
    if (method === "POST" && action === "next") return nextQuestion(s, now);
    if (method === "POST" && action === "guess") return guess(s, body ?? {}, now);
    if (method === "GET" && action === "reveal" && arg !== undefined) return reveal(s, Number(arg), now);
    if (method === "POST" && action === "finish") return finish(s, now);
  }
  throw new HttpError(404, `No route for ${method} ${path}`);
}
