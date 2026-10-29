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
// Answer indexes: KV `qidx:<id>`, cached in memory for the life of the isolate.
// ---------------------------------------------------------------------------

const indexCache = new Map<string, AnswerIndex>();
const INDEX_CACHE_MAX = 300;

export function indexFor(row: Pick<QuestionRow, "id" | "data">): AnswerIndex {
  const content = parseContent(row);
  return buildIndex({ id: row.id, answers: content.answers, nearMisses: content.nearMisses });
}

export async function storeIndex(env: Env, row: Pick<QuestionRow, "id" | "data">): Promise<void> {
  const index = indexFor(row);
  indexCache.set(row.id, index);
  await env.KV.put(`qidx:${row.id}`, JSON.stringify(index));
}

export function forgetIndex(id: string) {
  indexCache.delete(id);
}

export async function getIndex(env: Env, questionId: string): Promise<AnswerIndex> {
  const cached = indexCache.get(questionId);
  if (cached) return cached;
  let index = await env.KV.get<AnswerIndex>(`qidx:${questionId}`, "json");
  if (!index) {
    // Self-heal: rebuild from D1 if KV is missing the entry.
    const row = await env.DB.prepare("SELECT id, data FROM questions WHERE id = ?").bind(questionId).first<QuestionRow>();
    if (!row) throw new Error(`Unknown question ${questionId}`);
    index = indexFor(row);
    await env.KV.put(`qidx:${questionId}`, JSON.stringify(index));
  }
  if (indexCache.size >= INDEX_CACHE_MAX) indexCache.delete(indexCache.keys().next().value!);
  indexCache.set(questionId, index);
  return index;
}

export async function getQuestion(env: Env, id: string): Promise<QuestionRow | null> {
  return env.DB.prepare("SELECT * FROM questions WHERE id = ?").bind(id).first<QuestionRow>();
}

export async function getQuestions(env: Env, ids: string[]): Promise<Map<string, QuestionRow>> {
  if (ids.length === 0) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT * FROM questions WHERE id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(ids))
    .all<QuestionRow>();
  return new Map(results.map((r) => [r.id, r]));
}

// ---------------------------------------------------------------------------
// Daily sets
// ---------------------------------------------------------------------------

/**
 * The Daily set for a date. Built (and locked) the first time anyone asks for
 * it: scheduled questions for that date by slot, then `reserve` questions,
 * then Unlimited questions that haven't been a Daily in the last 90 days.
 */
export async function getDailySet(env: Env, date: string): Promise<string[]> {
  const existing = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date = ?").bind(date).first<{ question_ids: string }>();
  if (existing) return JSON.parse(existing.question_ids);

  const { results: scheduled } = await env.DB.prepare(
    "SELECT id, daily_slot FROM questions WHERE daily_date = ? AND status != 'retired' ORDER BY daily_slot",
  )
    .bind(date)
    .all<{ id: string; daily_slot: number }>();

  const slots: (string | null)[] = Array(QUESTIONS_PER_DAY).fill(null);
  for (const q of scheduled) if (q.daily_slot >= 1 && q.daily_slot <= QUESTIONS_PER_DAY) slots[q.daily_slot - 1] = q.id;
  const open = slots.map((id, i) => (id ? -1 : i)).filter((i) => i >= 0);

  if (open.length) {
    const { results: reserve } = await env.DB.prepare(
      "SELECT id FROM questions WHERE status = 'reserve' ORDER BY RANDOM() LIMIT ?",
    )
      .bind(open.length)
      .all<{ id: string }>();
    const stmts = [];
    for (const r of reserve) {
      const slot = open.shift()!;
      slots[slot] = r.id;
      // Reserve questions become this day's scheduled questions (and join Unlimited once aired).
      stmts.push(
        env.DB.prepare("UPDATE questions SET status = 'scheduled', daily_date = ?, daily_slot = ? WHERE id = ?").bind(date, slot + 1, r.id),
      );
    }
    if (stmts.length) await env.DB.batch(stmts);
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
  return locked ? JSON.parse(locked.question_ids) : ids;
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
  const todays = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date = ?").bind(date).first<{ question_ids: string }>();
  return [date, todays?.question_ids ?? "[]"];
}

export { normalizePrompt };

/** Questions for a party game: today's Daily set, random Unlimited, or one category. */
export async function pickRoomQuestions(
  env: Env,
  source: "daily" | "unlimited" | "category",
  category: Category | undefined,
  count: number,
  now = Date.now(),
): Promise<string[]> {
  const ids: string[] = source === "daily" ? (await getDailySet(env, today(now))).slice(0, count) : [];
  if (ids.length < count) {
    const [date, todays] = await unlimitedParams(env, now);
    const exclude = JSON.stringify([...JSON.parse(todays), ...ids]);
    const catClause = source === "category" && category ? " AND category = ?3" : "";
    const stmt = env.DB.prepare(
      `SELECT id FROM questions WHERE ${UNLIMITED_WHERE}${catClause} ORDER BY RANDOM() LIMIT ${Math.max(1, count - ids.length)}`,
    );
    const { results } = await (catClause ? stmt.bind(date, exclude, category) : stmt.bind(date, exclude)).all<{ id: string }>();
    ids.push(...results.map((r) => r.id));
  }
  return ids;
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
