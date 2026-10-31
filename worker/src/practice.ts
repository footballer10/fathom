import { Hono } from "hono";
import type { Context } from "hono";
import { TIERS, matchGuess } from "@fathom/shared";
import type { TierPoints } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { recordRejected } from "./rejected";
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
  const playerId = pid(c);
  const body = await c.req.json<{ exclude?: string[]; minAnswers?: number; tier?: number; runId?: string }>().catch(() => ({}) as { exclude?: string[]; minAnswers?: number; tier?: number; runId?: string });
  const run = body.runId ? await loadRun(c.env, body.runId, playerId) : null;
  // Rarity Roulette runs get their target tier from the server, so the score can be checked.
  if (run?.mode === "roulette") body.tier = ROULETTE_TARGETS[Math.floor(Math.random() * ROULETTE_TARGETS.length)];
  if (run) body.exclude = [...(body.exclude ?? []), ...run.data.questions.map((q) => q.id)];
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
  if (run) {
    run.data.questions.push({ id: row.id, target: tier, at: Date.now() });
    await saveRun(c.env, run);
  }
  return c.json({ id: row.id, prompt: row.prompt, category: row.category, answerCount: row.n, target: tier });
});

/** Check one guess. `taken` are answer ids you've already used (Five Answers, Abyss). */
practiceRoutes.post("/api/practice/guess", async (c) => {
  pid(c);
  const body = await c.req.json<{ id?: string; text?: string; taken?: string[]; confirm?: boolean; runId?: string }>().catch(
    () => ({}) as { id?: string; text?: string; taken?: string[]; confirm?: boolean; runId?: string },
  );
  if (!body.id || !body.text) throw new HttpError(400, "Missing guess");
  const index = await getIndex(c.env, String(body.id)).catch(() => null);
  if (!index) throw new HttpError(404, "No such question");
  const r = matchGuess(index, String(body.text).slice(0, 100), { takenAnswerIds: new Set((body.taken ?? []).map(String)) });
  if (r.accepted && r.corrected && !body.confirm) {
    return c.json({ accepted: false, answerId: null, canonical: r.canonical, tier: null, points: 0, corrected: true, reason: "confirm" });
  }
  if (!r.accepted && r.reason !== "taken") c.executionCtx.waitUntil(recordRejected(c.env, index.questionId, index, String(body.text), Date.now()));
  if (body.runId && r.accepted && r.answerId && r.tier) {
    const run = await loadRun(c.env, body.runId, pid(c));
    if (run && !run.finished && run.data.questions.some((q) => q.id === body.id)) {
      run.data.accepted.push({ qid: String(body.id), answerId: r.answerId, tier: r.tier, points: r.points, at: Date.now() });
      await saveRun(c.env, run);
    }
  }
  return c.json({ accepted: r.accepted, answerId: r.answerId, canonical: r.canonical, tier: r.tier, points: r.points, corrected: r.corrected, reason: r.reason });
});

// ---------------------------------------------------------------------------
// Scored runs for the quick modes. The server keeps the questions it handed out
// and the answers it accepted, and works the score out itself at the end, so the
// leaderboards can be trusted.
// ---------------------------------------------------------------------------

export type PracticeMode = "sprint" | "ladder" | "roulette" | "five";
const MODES: readonly PracticeMode[] = ["sprint", "ladder", "roulette", "five"];
const ROULETTE_TARGETS: TierPoints[] = [10, 30, 30, 60, 60, 85];
const SLACK_MS = 2500; // network and timer slop

interface RunData {
  questions: { id: string; target: number | null; at: number }[];
  accepted: { qid: string; answerId: string; tier: TierPoints; points: number; at: number }[];
}
interface Run {
  id: string;
  player_id: string;
  mode: PracticeMode;
  started_at: number;
  finished: number;
  score: number | null;
  data: RunData;
}

let runsReady = false;
export async function ensureRuns(env: Env) {
  if (runsReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS practice_runs (
         id TEXT PRIMARY KEY, player_id TEXT NOT NULL, mode TEXT NOT NULL, started_at INTEGER NOT NULL,
         finished INTEGER NOT NULL DEFAULT 0, score INTEGER, data TEXT NOT NULL)`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_practice_runs_mode ON practice_runs(mode, finished, score)"),
  ]);
  runsReady = true;
}

async function loadRun(env: Env, id: string, playerId: string): Promise<Run | null> {
  await ensureRuns(env);
  const row = await env.DB.prepare("SELECT * FROM practice_runs WHERE id = ? AND player_id = ?").bind(id, playerId).first<Omit<Run, "data"> & { data: string }>();
  return row ? { ...row, data: JSON.parse(row.data) as RunData } : null;
}

async function saveRun(env: Env, run: Run) {
  await env.DB.prepare("UPDATE practice_runs SET data = ?, finished = ?, score = ? WHERE id = ?").bind(JSON.stringify(run.data), run.finished, run.score, run.id).run();
}

/** Work out a run's score from what the server saw, using each mode's rules. */
export function scoreRun(run: Pick<Run, "mode" | "started_at" | "data">): number {
  const { questions, accepted } = run.data;
  const firstFor = (qid: string, until: number, ok: (a: RunData["accepted"][number]) => boolean = () => true) =>
    accepted.filter((a) => a.qid === qid && a.at <= until && ok(a)).sort((x, y) => x.at - y.at)[0];
  const end60 = run.started_at + 60_000 + SLACK_MS;
  if (run.mode === "sprint") {
    return questions.reduce((n, q) => n + (firstFor(q.id, end60)?.points ?? 0), 0);
  }
  if (run.mode === "five") {
    const q = questions[0];
    if (!q) return 0;
    const seen = new Set<string>();
    let total = 0;
    for (const a of accepted.filter((x) => x.qid === q.id && x.at <= end60).sort((x, y) => x.at - y.at)) {
      if (seen.has(a.answerId) || seen.size >= 5) continue;
      seen.add(a.answerId);
      total += a.points;
    }
    return total;
  }
  if (run.mode === "ladder") {
    let floor = 0;
    let rungs = 0;
    for (const q of questions) {
      const a = firstFor(q.id, q.at + 25_000 + SLACK_MS);
      if (!a || a.tier < floor) break;
      floor = a.tier;
      rungs++;
    }
    return rungs;
  }
  // roulette: a hit is any accepted answer in the target tier, in time, on the first 7 prompts
  return questions.slice(0, 7).filter((q) => q.target && firstFor(q.id, q.at + 25_000 + SLACK_MS, (a) => a.tier === q.target)).length;
}

practiceRoutes.post("/api/practice/start", async (c) => {
  const playerId = pid(c);
  const { mode } = await c.req.json<{ mode?: string }>().catch(() => ({ mode: "" }));
  if (!(MODES as readonly string[]).includes(String(mode))) throw new HttpError(400, "Unknown mode");
  await ensureRuns(c.env);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare("INSERT OR IGNORE INTO players (id, created_at) VALUES (?, ?)").bind(playerId, now).run();
  await c.env.DB.prepare("INSERT INTO practice_runs (id, player_id, mode, started_at, data) VALUES (?, ?, ?, ?, ?)")
    .bind(id, playerId, mode, now, JSON.stringify({ questions: [], accepted: [] } satisfies RunData))
    .run();
  return c.json({ runId: id, startedAt: now });
});

practiceRoutes.post("/api/practice/finish", async (c) => {
  const playerId = pid(c);
  const { runId } = await c.req.json<{ runId?: string }>().catch(() => ({ runId: "" }));
  const run = await loadRun(c.env, String(runId ?? ""), playerId);
  if (!run) throw new HttpError(404, "No such run");
  if (!run.finished) {
    run.finished = 1;
    run.score = scoreRun(run);
    await saveRun(c.env, run);
  }
  const best = await c.env.DB.prepare("SELECT MAX(score) AS best FROM practice_runs WHERE player_id = ? AND mode = ? AND finished = 1")
    .bind(playerId, run.mode)
    .first<{ best: number | null }>();
  return c.json({ score: run.score ?? 0, best: best?.best ?? run.score ?? 0 });
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
export async function ensureAbyss(env: Env) {
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
export function weekOf(now: number): { week: string; endsAt: number } {
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
    `SELECT a.player_id, a.best_tier, p.nickname FROM abyss_attempts a JOIN players p ON p.id = a.player_id
     WHERE a.week = ? AND a.best_tier IS NOT NULL AND p.nickname IS NOT NULL AND TRIM(p.nickname) != ''
     ORDER BY a.best_tier DESC, a.best_at - a.started_at ASC LIMIT 10`,
  )
    .bind(week)
    .all<{ player_id: string; best_tier: number; nickname: string }>();
  const divers = await env.DB.prepare("SELECT COUNT(*) AS n FROM abyss_attempts WHERE week = ?").bind(week).first<{ n: number }>();
  return {
    divers: divers?.n ?? 0,
    // Only the tier, never the answer itself: other people's Abyss answers stay secret.
    rows: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, tier: r.best_tier as TierPoints, you: r.player_id === playerId })),
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
  if (!r.accepted && r.reason !== "taken") c.executionCtx.waitUntil(recordRejected(c.env, a.question_id, index, String(text ?? ""), now));
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
