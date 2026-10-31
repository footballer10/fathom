import { Hono } from "hono";
import type { Context } from "hono";
import { TIERS, matchGuess } from "@fathom/shared";
import type { TierPoints } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { UNLIMITED_WHERE, getIndex, getQuestions, today, unlimitedParams } from "./questions";

/**
 * Practice API for the solo modes (Sprint, Ladder, Rarity Roulette, Five Answers)
 * and the Weekly Abyss. Practice questions come from the Unlimited pool but don't
 * use up your Unlimited (nothing is marked seen), and scores stay on your device.
 */

type AppEnv = { Bindings: Env };
export const practiceRoutes = new Hono<AppEnv>();

function pid(c: Context<AppEnv>): string {
  const id = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  return id;
}

const ANSWER_COUNT = "json_array_length(json_extract(data, '$.answers'))";

/** A random Unlimited-pool prompt, skipping ones you've had this run. */
practiceRoutes.post("/api/practice/question", async (c) => {
  pid(c);
  const body = await c.req.json<{ exclude?: string[]; minAnswers?: number; tier?: number }>().catch(() => ({}) as { exclude?: string[]; minAnswers?: number; tier?: number });
  const exclude = (body.exclude ?? []).filter((x) => typeof x === "string").slice(-300);
  const minAnswers = Math.max(0, Math.min(200, Number(body.minAnswers) || 0));
  const [date, todays] = await unlimitedParams(c.env);
  // Rarity Roulette asks for a tier: only pick prompts that have at least one answer in it.
  const tier = TIERS.some((t) => t.points === Number(body.tier)) ? Number(body.tier) : null;
  const row = await c.env.DB.prepare(
    `SELECT id, prompt, category, ${ANSWER_COUNT} AS n FROM questions
     WHERE ${UNLIMITED_WHERE} AND id NOT IN (SELECT value FROM json_each(?3)) AND ${ANSWER_COUNT} >= ?4
       ${tier ? "AND EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.answers')) a WHERE json_extract(a.value, '$.tier') = ?5)" : ""}
     ORDER BY RANDOM() LIMIT 1`,
  )
    .bind(date, todays, JSON.stringify(exclude), minAnswers, ...(tier ? [tier] : []))
    .first<{ id: string; prompt: string; category: string; n: number }>();
  if (!row) throw new HttpError(404, "No more prompts for this run");
  return c.json({ id: row.id, prompt: row.prompt, category: row.category, answerCount: row.n });
});

/** Check one guess. `taken` are answer ids you've already used (Five Answers, Abyss). */
practiceRoutes.post("/api/practice/guess", async (c) => {
  pid(c);
  const body = await c.req.json<{ id?: string; text?: string; taken?: string[]; confirm?: boolean }>().catch(() => ({}) as { id?: string; text?: string; taken?: string[]; confirm?: boolean });
  if (!body.id || !body.text) throw new HttpError(400, "Missing guess");
  const index = await getIndex(c.env, String(body.id)).catch(() => null);
  if (!index) throw new HttpError(404, "No such question");
  const r = matchGuess(index, String(body.text).slice(0, 100), { takenAnswerIds: new Set((body.taken ?? []).map(String)) });
  if (r.accepted && r.corrected && !body.confirm) {
    return c.json({ accepted: false, answerId: null, canonical: r.canonical, tier: null, points: 0, corrected: true, reason: "confirm" });
  }
  return c.json({ accepted: r.accepted, answerId: r.answerId, canonical: r.canonical, tier: r.tier, points: r.points, corrected: r.corrected, reason: r.reason });
});

/** Every valid answer, for the end-of-prompt reveal. */
practiceRoutes.get("/api/practice/answers/:id", async (c) => {
  const index = await getIndex(c.env, c.req.param("id")).catch(() => null);
  if (!index) throw new HttpError(404, "No such question");
  return c.json({ answers: index.answers.map((a) => ({ answerId: a.id, canonical: a.canonical, tier: a.tier })) });
});

// ---------------------------------------------------------------------------
// Weekly Abyss: one very deep prompt per week, one 45-second attempt each.
// ---------------------------------------------------------------------------

export const ABYSS_SECONDS = 45;
const ABYSS_GRACE_MS = 1500;

let abyssReady = false;
async function ensureAbyss(env: Env) {
  if (abyssReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS abyss_attempts (
         week TEXT NOT NULL, player_id TEXT NOT NULL, question_id TEXT NOT NULL, started_at INTEGER NOT NULL,
         best_tier INTEGER, best_answer TEXT, best_at INTEGER, answers TEXT NOT NULL DEFAULT '[]',
         PRIMARY KEY (week, player_id))`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_abyss_week ON abyss_attempts(week, best_tier)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS abyss_weeks (week TEXT PRIMARY KEY, question_id TEXT NOT NULL)"),
  ]);
  abyssReady = true;
}

/** Weeks start on Monday (Mountain time, like the Daily). Returns the Monday's date. */
function weekOf(now: number): { week: string; endsAt: number } {
  const d = new Date(`${today(now)}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  const week = d.toISOString().slice(0, 10);
  // Roughly when the next week starts (next Monday ~ midnight Mountain), for the countdown.
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 7);
  return { week, endsAt: next.getTime() - 12 * 3_600_000 + 7 * 3_600_000 };
}

/** The week's prompt: chosen once per week from the 40 biggest answer lists, then fixed. */
async function abyssQuestion(env: Env, week: string, now: number) {
  await ensureAbyss(env);
  const fixed = await env.DB.prepare("SELECT question_id FROM abyss_weeks WHERE week = ?").bind(week).first<{ question_id: string }>();
  let qid = fixed?.question_id;
  if (!qid) {
    const [date, todays] = await unlimitedParams(env, now);
    const { results } = await env.DB.prepare(
      `SELECT id FROM questions WHERE ${UNLIMITED_WHERE}
         AND id NOT IN (SELECT question_id FROM abyss_weeks)
       ORDER BY ${ANSWER_COUNT} DESC LIMIT 40`,
    )
      .bind(date, todays)
      .all<{ id: string }>();
    if (!results.length) throw new HttpError(503, "No Abyss prompt available yet");
    let h = 0;
    for (const ch of week) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    qid = results[h % results.length].id;
    await env.DB.prepare("INSERT OR IGNORE INTO abyss_weeks (week, question_id) VALUES (?, ?)").bind(week, qid).run();
    qid = (await env.DB.prepare("SELECT question_id FROM abyss_weeks WHERE week = ?").bind(week).first<{ question_id: string }>())!.question_id;
  }
  const q = (await getQuestions(env, [qid])).get(qid);
  if (!q) throw new HttpError(503, "The Abyss prompt went missing");
  return q;
}

type AbyssRow = { week: string; player_id: string; question_id: string; started_at: number; best_tier: number | null; best_answer: string | null; best_at: number | null; answers: string };

async function abyssBoard(env: Env, week: string, playerId: string) {
  const { results } = await env.DB.prepare(
    `SELECT a.player_id, a.best_tier, a.best_answer, p.nickname FROM abyss_attempts a JOIN players p ON p.id = a.player_id
     WHERE a.week = ? AND a.best_tier IS NOT NULL AND p.nickname IS NOT NULL AND TRIM(p.nickname) != ''
     ORDER BY a.best_tier DESC, a.best_at - a.started_at ASC LIMIT 10`,
  )
    .bind(week)
    .all<{ player_id: string; best_tier: number; best_answer: string; nickname: string }>();
  const divers = await env.DB.prepare("SELECT COUNT(*) AS n FROM abyss_attempts WHERE week = ?").bind(week).first<{ n: number }>();
  return {
    divers: divers?.n ?? 0,
    rows: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, tier: r.best_tier as TierPoints, answer: r.best_answer, you: r.player_id === playerId })),
  };
}

function attemptView(a: AbyssRow | null, now: number) {
  if (!a) return null;
  const endsAt = a.started_at + ABYSS_SECONDS * 1000;
  return {
    startedAt: a.started_at,
    endsAt,
    done: now > endsAt + ABYSS_GRACE_MS,
    best: a.best_tier ? { tier: a.best_tier as TierPoints, canonical: a.best_answer! } : null,
    answers: JSON.parse(a.answers) as { answerId: string; canonical: string; tier: TierPoints }[],
  };
}

practiceRoutes.get("/api/abyss", async (c) => {
  const playerId = pid(c);
  const now = Date.now();
  const { week, endsAt } = weekOf(now);
  const q = await abyssQuestion(c.env, week, now);
  const a = await c.env.DB.prepare("SELECT * FROM abyss_attempts WHERE week = ? AND player_id = ?").bind(week, playerId).first<AbyssRow>();
  const view = attemptView(a, now);
  return c.json({
    week,
    weekEndsAt: endsAt,
    seconds: ABYSS_SECONDS,
    category: q.category,
    // The prompt stays hidden until you start, so nobody can prepare.
    prompt: view ? q.prompt : null,
    attempt: view,
    board: await abyssBoard(c.env, week, playerId),
  });
});

practiceRoutes.post("/api/abyss/start", async (c) => {
  const playerId = pid(c);
  const now = Date.now();
  const { week } = weekOf(now);
  const q = await abyssQuestion(c.env, week, now);
  await getIndex(c.env, q.id);
  await c.env.DB.prepare("INSERT OR IGNORE INTO players (id, created_at) VALUES (?, ?)").bind(playerId, now).run();
  await c.env.DB.prepare("INSERT OR IGNORE INTO abyss_attempts (week, player_id, question_id, started_at) VALUES (?, ?, ?, ?)").bind(week, playerId, q.id, now).run();
  const a = await c.env.DB.prepare("SELECT * FROM abyss_attempts WHERE week = ? AND player_id = ?").bind(week, playerId).first<AbyssRow>();
  return c.json({ prompt: q.prompt, category: q.category, attempt: attemptView(a, now) });
});

practiceRoutes.post("/api/abyss/guess", async (c) => {
  const playerId = pid(c);
  const now = Date.now();
  const { week } = weekOf(now);
  const { text, confirm } = await c.req.json<{ text?: string; confirm?: boolean }>().catch(() => ({ text: "", confirm: false }));
  const a = await c.env.DB.prepare("SELECT * FROM abyss_attempts WHERE week = ? AND player_id = ?").bind(week, playerId).first<AbyssRow>();
  if (!a) throw new HttpError(400, "Start your dive first");
  if (now > a.started_at + ABYSS_SECONDS * 1000 + ABYSS_GRACE_MS) throw new HttpError(400, "Time's up for this week's dive");
  const answers = JSON.parse(a.answers) as { answerId: string; canonical: string; tier: TierPoints }[];
  const index = await getIndex(c.env, a.question_id);
  const r = matchGuess(index, String(text ?? "").slice(0, 100), { takenAnswerIds: new Set(answers.map((x) => x.answerId)) });
  if (r.accepted && r.corrected && !confirm) return c.json({ accepted: false, canonical: r.canonical, tier: null, points: 0, reason: "confirm" });
  if (r.accepted && r.answerId && r.canonical && r.tier) {
    answers.push({ answerId: r.answerId, canonical: r.canonical, tier: r.tier });
    const better = !a.best_tier || r.tier > a.best_tier;
    await c.env.DB.prepare(
      `UPDATE abyss_attempts SET answers = ?, best_tier = ?, best_answer = ?, best_at = ? WHERE week = ? AND player_id = ?`,
    )
      .bind(JSON.stringify(answers), better ? r.tier : a.best_tier, better ? r.canonical : a.best_answer, better ? now : a.best_at, week, playerId)
      .run();
  }
  return c.json({ accepted: r.accepted, canonical: r.canonical, tier: r.tier, points: r.points, reason: r.reason });
});
