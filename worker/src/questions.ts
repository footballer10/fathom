import {
  dailyNumberFor,
  QUESTIONS_PER_DAY,
  addDays,
  buildIndex,
  dailyDateFor,
  normalizePrompt,
} from "@fathom/shared";
import type { AnswerIndex, Category, TierPoints } from "@fathom/shared";
import type { Env } from "./env";

/** One stored answer. IDs are stable forever (plays and stats point at them). */
export interface StoredAnswer {
  id: string;
  text: string;
  aliases?: string[];
  tier: TierPoints;
}

export interface QuestionContent {
  answers: StoredAnswer[];
  nearMisses: string[];
  notes?: string;
}

export interface QuestionRow {
  id: string;
  prompt: string;
  category: Category;
  status: "reserve" | "scheduled" | "unlimited" | "retired";
  daily_date: string | null;
  daily_slot: number | null;
  source: string;
  data: string;
  answer_count: number;
  plays: number;
  created_at: number;
  retired_at: number | null;
}

export function parseContent(row: Pick<QuestionRow, "data">): QuestionContent {
  return JSON.parse(row.data) as QuestionContent;
}

export function today(now = Date.now()): string {
  return dailyDateFor(now);
}

// ---------------------------------------------------------------------------
// Answer indexes: KV `qidx2:<id>`, cached in memory for the life of the isolate.
// (The key version goes up whenever the index format changes; old keys are rebuilt on demand.)
// ---------------------------------------------------------------------------

const indexCache = new Map<string, AnswerIndex>();
const INDEX_CACHE_MAX = 300;

export const INDEX_KEY = (id: string) => `qidx2:${id}`;

export function indexFor(row: Pick<QuestionRow, "id" | "data" | "prompt">): AnswerIndex {
  const content = parseContent(row);
  return buildIndex({ id: row.id, prompt: row.prompt, answers: content.answers, nearMisses: content.nearMisses });
}

export async function storeIndex(env: Env, row: Pick<QuestionRow, "id" | "data" | "prompt">): Promise<void> {
  const index = indexFor(row);
  indexCache.set(row.id, index);
  await env.KV.put(INDEX_KEY(row.id), JSON.stringify(index));
}

export function forgetIndex(id: string) {
  indexCache.delete(id);
}

export async function getIndex(env: Env, questionId: string): Promise<AnswerIndex> {
  const cached = indexCache.get(questionId);
  if (cached) return cached;
  let index = await env.KV.get<AnswerIndex>(INDEX_KEY(questionId), "json");
  if (!index) {
    // Self-heal: rebuild from D1 if KV is missing the entry.
    const row = await env.DB.prepare("SELECT id, prompt, data FROM questions WHERE id = ?").bind(questionId).first<QuestionRow>();
    if (!row) throw new Error(`Unknown question ${questionId}`);
    index = indexFor(row);
    await env.KV.put(INDEX_KEY(questionId), JSON.stringify(index));
  }
  if (indexCache.size >= INDEX_CACHE_MAX) indexCache.delete(indexCache.keys().next().value!);
  indexCache.set(questionId, index);
  return index;
}

export async function getQuestion(env: Env, id: string): Promise<QuestionRow | null> {
  return env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first<QuestionRow>();
}

/**
 * Question rows are read on every step of a dive, but they hardly ever change,
 * so each server instance keeps recently used ones for 10 minutes (an admin edit
 * shows up within that time).
 */
const QUESTION_CACHE_MS = 10 * 60_000;
const questionCache = new Map<string, { at: number; row: QuestionRow }>();

export async function getQuestions(env: Env, ids: string[]): Promise<Map<string, QuestionRow>> {
  const out = new Map<string, QuestionRow>();
  const now = Date.now();
  const missing: string[] = [];
  for (const id of ids) {
    const hit = questionCache.get(id);
    if (hit && now - hit.at < QUESTION_CACHE_MS) out.set(id, hit.row);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const { results } = await env.DB.prepare(`SELECT * FROM questions WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(missing))
    .all<QuestionRow>();
  for (const r of results) {
    out.set(r.id, r);
    questionCache.delete(r.id);
    questionCache.set(r.id, { at: now, row: r });
  }
  while (questionCache.size > 400) questionCache.delete(questionCache.keys().next().value!);
  return out;
}

// ---------------------------------------------------------------------------
// Daily sets
// ---------------------------------------------------------------------------

/**
 * The Daily set for a date. Built (and locked) the first time anyone asks for
 * it: scheduled questions for that date by slot, then `reserve` questions,
 * then Unlimited questions that haven't been a Daily in the last 90 days.
 */
/** A Daily set never changes once it's built, so each server instance keeps the last few in memory. */
const dailySetCache = new Map<string, string[]>();
function rememberDailySet(date: string, ids: string[]) {
  dailySetCache.set(date, ids);
  if (dailySetCache.size > 8) dailySetCache.delete(dailySetCache.keys().next().value!);
  return ids;
}

export async function getDailySet(env: Env, date: string): Promise<string[]> {
  const known = dailySetCache.get(date);
  if (known) return known;
  const existing = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date = ?").bind(date).first<{ question_ids: string }>();
  if (existing) return rememberDailySet(date, JSON.parse(existing.question_ids));

  const { results: scheduled } = await env.DB.prepare(
    "SELECT id, daily_slot FROM questions WHERE daily_date = ? AND status != 'retired' ORDER BY daily_slot",
  )
    .bind(date)
    .all<{ id: string; daily_slot: number }>();

  const slots: (string | null)[] = Array(QUESTIONS_PER_DAY).fill(null);
  const fillScheduled = (rows: { id: string; daily_slot: number }[]) => {
    for (const q of rows) if (q.daily_slot >= 1 && q.daily_slot <= QUESTIONS_PER_DAY) slots[q.daily_slot - 1] = q.id;
  };
  fillScheduled(scheduled);
  let open = slots.map((id, i) => (id ? -1 : i)).filter((i) => i >= 0);

  if (open.length) {
    const { results: reserve } = await env.DB.prepare(
      "SELECT id FROM questions WHERE status = 'reserve' ORDER BY RANDOM() LIMIT ?",
    )
      .bind(open.length)
      .all<{ id: string }>();
    // Reserve questions become this day's scheduled questions (and join Unlimited once aired).
    // Each claim only succeeds if the slot is still empty, so two requests building the same
    // day at once can't collide; afterwards we re-read who actually holds each slot.
    const stmts = reserve.map((r, i) =>
      env.DB.prepare(
        `UPDATE questions SET status = 'scheduled', daily_date = ?1, daily_slot = ?2
         WHERE id = ?3 AND status = 'reserve'
           AND NOT EXISTS (SELECT 1 FROM questions WHERE daily_date = ?1 AND daily_slot = ?2)`,
      ).bind(date, open[i] + 1, r.id),
    );
    if (stmts.length) {
      await env.DB.batch(stmts);
      const { results: claimed } = await env.DB.prepare(
        "SELECT id, daily_slot FROM questions WHERE daily_date = ? AND status != 'retired' ORDER BY daily_slot",
      )
        .bind(date)
        .all<{ id: string; daily_slot: number }>();
      fillScheduled(claimed);
      open = slots.map((id, i) => (id ? -1 : i)).filter((i) => i >= 0);
    }
  }

  if (open.length) {
    const since = addDays(date, -90);
    const { results: recent } = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date >= ?")
      .bind(since)
      .all<{ question_ids: string }>();
    const recentIds = new Set(recent.flatMap((r) => JSON.parse(r.question_ids) as string[]));
    for (const id of slots) if (id) recentIds.add(id);
    const { results: pool } = await env.DB.prepare(
      `SELECT id FROM questions
       WHERE (status = 'unlimited' OR (status = 'scheduled' AND daily_date < ?))
         AND id NOT IN (SELECT value FROM json_each(?))
       ORDER BY plays ASC, RANDOM() LIMIT ?`,
    )
      .bind(date, JSON.stringify([...recentIds]), open.length)
      .all<{ id: string }>();
    for (const r of pool) slots[open.shift()!] = r.id;
  }

  const ids = slots.filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  // Lock it. If two requests raced, the first insert wins and we re-read it.
  await env.DB.prepare("INSERT OR IGNORE INTO daily_sets (date, question_ids, status) VALUES (?, ?, 'locked')")
    .bind(date, JSON.stringify(ids))
    .run();
  const locked = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date = ?").bind(date).first<{ question_ids: string }>();
  return rememberDailySet(date, locked ? JSON.parse(locked.question_ids) : ids);
}

// ---------------------------------------------------------------------------
// Unlimited pool
// ---------------------------------------------------------------------------

/**
 * SQL for "in the Unlimited pool today": status unlimited, or a Daily that has
 * already aired. Never anything scheduled for today or later, never reserve,
 * never retired, and never anything in today's Daily set.
 */
export const UNLIMITED_WHERE = `(status = 'unlimited' OR (status = 'scheduled' AND daily_date < ?1))
  AND id NOT IN (SELECT value FROM json_each(?2))`;

export async function unlimitedParams(env: Env, now = Date.now()): Promise<[string, string]> {
  const date = today(now);
  const known = dailySetCache.get(date);
  if (known) return [date, JSON.stringify(known)];
  const todays = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date = ?").bind(date).first<{ question_ids: string }>();
  if (todays) rememberDailySet(date, JSON.parse(todays.question_ids));
  return [date, todays?.question_ids ?? "[]"];
}

export interface PoolQuestion {
  id: string;
  prompt: string;
  category: Category;
  /** How many answers it has. */
  n: number;
}

const POOL_MINUTES = 30;
let poolCache: { at: number; date: string; rows: PoolQuestion[] } | null = null;

/**
 * Today's Unlimited pool (id, prompt, category, answer count), read once per
 * server instance every 30 minutes (and whenever the date changes). Unlimited,
 * party games, quick modes and the category list all pick from it in memory
 * instead of scanning the questions table each time, which is what used up
 * D1's free daily reads. Admin changes show up within 30 minutes.
 */
export async function unlimitedPool(env: Env, now = Date.now()): Promise<PoolQuestion[]> {
  const date = today(now);
  if (poolCache && poolCache.date === date && now - poolCache.at < POOL_MINUTES * 60_000) return poolCache.rows;
  const [, todays] = await unlimitedParams(env, now);
  const { results } = await env.DB.prepare(
    `SELECT id, prompt, category, json_array_length(json_extract(data, '$.answers')) AS n FROM questions WHERE ${UNLIMITED_WHERE}`,
  )
    .bind(date, todays)
    .all<PoolQuestion>();
  poolCache = { at: now, date, rows: results };
  return results;
}

/** Forget the cached pool (after an admin edit in this instance). */
export function clearPoolCache() {
  poolCache = null;
}

/** `count` random items from a list (without repeats). */
export function sample<T>(items: readonly T[], count: number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, count);
}

export { normalizePrompt };

/** Questions for a party game: today's Daily set, random Unlimited, or one category. */
export async function pickRoomQuestions(
  env: Env,
  source: "daily" | "unlimited" | "category",
  category: Category | undefined,
  count: number,
  now = Date.now(),
  playerIds: string[] = [],
): Promise<string[]> {
  const ids: string[] = source === "daily" ? (await getDailySet(env, today(now))).slice(0, count) : [];
  if (ids.length < count) {
    const skip = new Set(ids);
    const pool = (await unlimitedPool(env, now)).filter((q) => !skip.has(q.id) && (source !== "category" || !category || q.category === category));
    // Questions fewer people in the room have seen in party games come first, so a group
    // doesn't keep getting the same prompts. Party history is kept apart from solo Unlimited's
    // (player ids prefixed "party:"), so party games never use up anyone's Unlimited questions.
    // Only the room's own history is read (by primary key), never the whole questions table.
    const seenBy = new Map<string, number>();
    if (playerIds.length) {
      const { results } = await env.DB.prepare(
        "SELECT question_id, COUNT(*) AS n FROM seen WHERE player_id IN (SELECT value FROM json_each(?)) GROUP BY question_id",
      )
        .bind(JSON.stringify(playerIds.map(partySeenId)))
        .all<{ question_id: string; n: number }>();
      for (const r of results) seenBy.set(r.question_id, r.n);
    }
    const shuffled = sample(pool, pool.length);
    shuffled.sort((a, b) => (seenBy.get(a.id) ?? 0) - (seenBy.get(b.id) ?? 0)); // stable, so ties stay random
    ids.push(...shuffled.slice(0, Math.max(1, count - ids.length)).map((q) => q.id));
  }
  return ids;
}

/** Party-game history lives in the same table under a prefixed id, separate from solo Unlimited. */
const partySeenId = (playerId: string) => `party:${playerId}`;

/** Remember that everyone in a room has now seen a question in a party game. */
export async function markRoomSeen(env: Env, playerIds: string[], questionId: string, now = Date.now()) {
  if (!playerIds.length) return;
  await env.DB.batch(
    playerIds.map((pid) =>
      env.DB.prepare("INSERT OR REPLACE INTO seen (player_id, question_id, seen_at) VALUES (?, ?, ?)").bind(partySeenId(pid), questionId, now),
    ),
  );
}

let launchDay: string | null = null;

/**
 * Daily number for a date. Day #1 is the first date the site served a Daily
 * (the earliest row in daily_sets), so numbering starts the day you launch.
 */
export async function dailyNumber(env: Env, date: string): Promise<number> {
  if (!launchDay) {
    const row = await env.DB.prepare("SELECT MIN(date) AS d FROM daily_sets").first<{ d: string | null }>();
    if (row?.d) launchDay = row.d; // fixed forever once set, so cache it
  }
  return dailyNumberFor(date, launchDay ?? date);
}
