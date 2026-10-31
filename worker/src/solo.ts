import {
  DEADLINE_GRACE_MS,
  PERCENTILE_MIN_RESULTS,
  QUESTIONS_PER_UNLIMITED_RUN,
  QUESTION_SECONDS,
  WRONG_GUESS_PENALTY_SECONDS,
  closestAnswer,
  compact,
  matchGuess,
  nextDailyResetAt,
  normalize,
  pointsToDepth,
  zoneForDepth,
} from "@fathom/shared";
import type {
  Category,
  DailyInfo,
  FinishResponse,
  GameMode,
  GuessResponse,
  PlayRecord,
  RevealResponse,
  SessionState,
  TierPoints,
} from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { UNLIMITED_WHERE, dailyNumber, getDailySet, getIndex, getQuestions, today, unlimitedParams } from "./questions";

/**
 * Solo game sessions with server-enforced timers.
 *
 * Timing model: when a question starts we store `question_started_at`. The
 * deadline is started_at + 25s − 2s per wrong guess. A guess counts if it
 * arrives before deadline + 250ms grace (network lag). Any request that
 * touches the session "settles" it first: if the deadline has passed with no
 * accepted answer, a 0-point miss is recorded. So the server never needs its
 * own timer; the clock is checked whenever the player talks to it.
 */

interface SessionRow {
  id: string;
  player_id: string;
  mode: GameMode;
  date: string | null;
  question_ids: string;
  current_index: number;
  question_started_at: number;
  penalties: number;
  current_done: number;
  finished: number;
  created_at: number;
}

interface PlayRow {
  session_id: string;
  idx: number;
  question_id: string;
  answer_id: string | null;
  canonical: string | null;
  tier: TierPoints | null;
  points: number;
  ms_used: number;
  corrected: number;
}

const endsAt = (s: SessionRow) =>
  s.question_started_at + QUESTION_SECONDS * 1000 - s.penalties * WRONG_GUESS_PENALTY_SECONDS * 1000;

async function loadSession(env: Env, id: string, playerId: string): Promise<SessionRow> {
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
  if (!s || s.player_id !== playerId) throw new HttpError(404, "Session not found");
  return s;
}

async function loadPlays(env: Env, sessionId: string): Promise<PlayRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM plays WHERE session_id = ? ORDER BY idx").bind(sessionId).all<PlayRow>();
  return results;
}

/** Record a timeout miss if the current question's clock ran out. Returns true if it changed anything. */
async function settle(env: Env, s: SessionRow, now: number): Promise<boolean> {
  if (s.current_index < 0 || s.current_done) return false;
  if (now <= endsAt(s) + DEADLINE_GRACE_MS) return false;
  const qid = (JSON.parse(s.question_ids) as string[])[s.current_index];
  const res = await env.DB.prepare(
    "UPDATE sessions SET current_done = 1 WHERE id = ? AND current_index = ? AND current_done = 0",
  )
    .bind(s.id, s.current_index)
    .run();
  if (res.meta.changes) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO plays (session_id, idx, question_id, answer_id, canonical, tier, points, ms_used, corrected, created_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, 0, ?, 0, ?)`,
    )
      .bind(s.id, s.current_index, qid, QUESTION_SECONDS * 1000, now)
      .run();
  }
  s.current_done = 1;
  return true;
}

async function toState(env: Env, s: SessionRow, now: number): Promise<SessionState> {
  await settle(env, s, now);
  const ids = JSON.parse(s.question_ids) as string[];
  const plays = await loadPlays(env, s.id);
  const questions = await getQuestions(env, ids);
  const cur = s.current_index >= 0 ? questions.get(ids[s.current_index]) : undefined;
  return {
    sessionId: s.id,
    mode: s.mode,
    dailyNumber: s.date ? await dailyNumber(env, s.date) : null,
    date: s.date,
    total: ids.length,
    plays: plays.map((p) => toPlayRecord(p, questions.get(p.question_id)?.prompt ?? "")),
    current: cur
      ? { index: s.current_index, questionId: cur.id, prompt: cur.prompt, category: cur.category, endsAt: endsAt(s) }
      : null,
    currentDone: !!s.current_done,
    finished: !!s.finished,
    serverNow: now,
  };
}

function toPlayRecord(p: PlayRow, prompt: string): PlayRecord {
  return {
    index: p.idx,
    questionId: p.question_id,
    prompt,
    answerId: p.answer_id,
    canonical: p.canonical,
    tier: p.tier,
    points: p.points,
    corrected: !!p.corrected,
    msUsed: p.ms_used,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function getDaily(env: Env, playerId: string, now: number): Promise<DailyInfo & { status: string }> {
  const date = today(now);
  const ids = await getDailySet(env, date);
  const questions = await getQuestions(env, ids);
  const s = await env.DB.prepare("SELECT finished FROM sessions WHERE player_id = ? AND date = ? AND mode = 'daily'")
    .bind(playerId, date)
    .first<{ finished: number }>();
  return {
    dailyNumber: await dailyNumber(env, date),
    date,
    prompts: ids.map((id, index) => ({ index, prompt: questions.get(id)?.prompt ?? "", category: questions.get(id)!.category })),
    nextDailyAt: nextDailyResetAt(now),
    serverNow: now,
    status: !s ? "new" : s.finished ? "finished" : "in-progress",
  };
}

async function ensurePlayer(env: Env, playerId: string, now: number) {
  await env.DB.prepare("INSERT OR IGNORE INTO players (id, created_at) VALUES (?, ?)").bind(playerId, now).run();
}

/**
 * Unlimited never repeats: each player sees a question here at most once, ever.
 * The "seen" list is permanent. Dailies and party games don't add to it, so a
 * question can still come up there. Runs get shorter as the last few unseen
 * questions are used up, and when none are left the player has finished Unlimited.
 */
async function pickUnlimited(env: Env, playerId: string, category: Category | undefined, now: number): Promise<string[]> {
  const [date, todays] = await unlimitedParams(env, now);
  const catClause = category ? " AND category = ?4" : "";
  const stmt = env.DB.prepare(
    `SELECT id FROM questions WHERE ${UNLIMITED_WHERE}${catClause}
       AND id NOT IN (SELECT question_id FROM seen WHERE player_id = ?3)
     ORDER BY RANDOM()
     LIMIT ${QUESTIONS_PER_UNLIMITED_RUN}`,
  );
  const { results } = await (category ? stmt.bind(date, todays, playerId, category) : stmt.bind(date, todays, playerId)).all<{ id: string }>();
  const ids = results.map((r) => r.id);
  if (!ids.length) {
    throw new HttpError(
      410,
      category ? "You've played every question in this category." : "You've played every Unlimited question.",
      category ? "unlimited-category-complete" : "unlimited-complete",
    );
  }
  await env.DB.batch(
    ids.map((id) => env.DB.prepare("INSERT OR IGNORE INTO seen (player_id, question_id, seen_at) VALUES (?, ?, ?)").bind(playerId, id, now)),
  );
  return ids;
}

export async function startSession(
  env: Env,
  playerId: string,
  body: { mode?: GameMode; category?: Category; date?: string },
  now: number,
): Promise<SessionState> {
  await ensurePlayer(env, playerId, now);
  const mode: GameMode = body.mode === "unlimited" || body.mode === "archive" ? body.mode : "daily";
  const date = today(now);

  if (mode === "archive") {
    // Replay a past Daily, just for fun: same questions, nothing is recorded.
    const day = String(body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= date) throw new HttpError(400, "Pick a past Daily");
    const row = await env.DB.prepare("SELECT question_ids FROM daily_sets WHERE date = ?").bind(day).first<{ question_ids: string }>();
    if (!row) throw new HttpError(404, "No Daily was played on that date");
    const s: SessionRow = {
      id: crypto.randomUUID(),
      player_id: playerId,
      mode,
      date: day,
      question_ids: row.question_ids,
      current_index: -1,
      question_started_at: 0,
      penalties: 0,
      current_done: 0,
      finished: 0,
      created_at: now,
    };
    await env.DB.prepare(`INSERT INTO sessions (id, player_id, mode, date, question_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(s.id, playerId, mode, day, s.question_ids, now)
      .run();
    return toState(env, s, now);
  }

  if (mode === "daily") {
    // One scored attempt per player per day: resume (or show) the existing session.
    const existing = await env.DB.prepare("SELECT * FROM sessions WHERE player_id = ? AND date = ? AND mode = 'daily'")
      .bind(playerId, date)
      .first<SessionRow>();
    if (existing) return toState(env, existing, now);
  }

  const ids = mode === "daily" ? await getDailySet(env, date) : await pickUnlimited(env, playerId, body.category, now);
  if (ids.length === 0) throw new HttpError(400, "No questions available right now");

  const s: SessionRow = {
    id: crypto.randomUUID(),
    player_id: playerId,
    mode,
    date: mode === "daily" ? date : null,
    question_ids: JSON.stringify(ids),
    current_index: -1,
    question_started_at: 0,
    penalties: 0,
    current_done: 0,
    finished: 0,
    created_at: now,
  };
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO sessions (id, player_id, mode, date, question_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(s.id, playerId, mode, s.date, s.question_ids, now)
    .run();
  if (!ins.meta.changes && mode === "daily") {
    // Lost a race with a double-click: return the session that won.
    const existing = await env.DB.prepare("SELECT * FROM sessions WHERE player_id = ? AND date = ? AND mode = 'daily'")
      .bind(playerId, date)
      .first<SessionRow>();
    if (existing) return toState(env, existing, now);
  }
  return toState(env, s, now);
}

export async function sessionState(env: Env, playerId: string, id: string, now: number) {
  return toState(env, await loadSession(env, id, playerId), now);
}

export async function nextQuestion(env: Env, playerId: string, id: string, now: number): Promise<SessionState> {
  const s = await loadSession(env, id, playerId);
  await settle(env, s, now);
  if (s.current_index >= 0 && !s.current_done) return toState(env, s, now); // still mid-question
  const ids = JSON.parse(s.question_ids) as string[];
  if (s.current_index + 1 >= ids.length) throw new HttpError(409, "No more questions");
  const nextIndex = s.current_index + 1;
  const res = await env.DB.prepare(
    `UPDATE sessions SET current_index = ?, question_started_at = ?, penalties = 0, current_done = 0
     WHERE id = ? AND current_index = ?`,
  )
    .bind(nextIndex, now, s.id, s.current_index)
    .run();
  if (res.meta.changes) {
    await env.DB.prepare("UPDATE questions SET plays = plays + 1 WHERE id = ?").bind(ids[nextIndex]).run();
    Object.assign(s, { current_index: nextIndex, question_started_at: now, penalties: 0, current_done: 0 });
    return toState(env, s, now);
  }
  return toState(env, await loadSession(env, id, playerId), now);
}

export async function guess(
  env: Env,
  playerId: string,
  id: string,
  body: { index?: number; text?: string; confirm?: boolean },
  now: number,
): Promise<GuessResponse> {
  const s = await loadSession(env, id, playerId);
  await settle(env, s, now);
  const lateResponse = (): GuessResponse => ({
    accepted: false,
    answerId: null,
    canonical: null,
    tier: null,
    points: 0,
    corrected: false,
    reason: "late",
    endsAt: endsAt(s),
    serverNow: now,
    questionDone: true,
  });
  if (body.index !== s.current_index || s.current_done || s.current_index < 0) return lateResponse();

  const ids = JSON.parse(s.question_ids) as string[];
  const qid = ids[s.current_index];
  const text = String(body.text ?? "").slice(0, 100);
  const index = await getIndex(env, qid);
  const result = matchGuess(index, text);

  // Autocorrected matches ask first ("Did you mean…?"); the client resends with confirm.
  if (result.accepted && result.corrected && !body.confirm) {
    return { accepted: false, answerId: null, canonical: result.canonical, tier: null, points: 0, corrected: true, reason: "confirm", endsAt: endsAt(s), serverNow: now, questionDone: false };
  }

  if (result.accepted) {
    // Only the first accepted answer counts, even if two requests race.
    const res = await env.DB.prepare(
      "UPDATE sessions SET current_done = 1 WHERE id = ? AND current_index = ? AND current_done = 0",
    )
      .bind(s.id, s.current_index)
      .run();
    if (!res.meta.changes) return lateResponse();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO plays (session_id, idx, question_id, answer_id, canonical, tier, points, ms_used, corrected, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        s.id,
        s.current_index,
        qid,
        result.answerId,
        result.canonical,
        result.tier,
        result.points,
        Math.min(now - s.question_started_at, QUESTION_SECONDS * 1000),
        result.corrected ? 1 : 0,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO answer_stats (answer_id, question_id, times_chosen) VALUES (?, ?, 1)
         ON CONFLICT(answer_id) DO UPDATE SET times_chosen = times_chosen + 1`,
      ).bind(result.answerId, qid),
    ]);
    return { ...result, endsAt: endsAt(s), serverNow: now, questionDone: true };
  }

  // Wrong guess: costs time, and the guess goes to the learning loop.
  const key = compact(normalize(text));
  const closest = key ? closestAnswer(index, text) : null;
  const stmts = [
    env.DB.prepare("UPDATE sessions SET penalties = penalties + 1 WHERE id = ? AND current_index = ? AND current_done = 0").bind(
      s.id,
      s.current_index,
    ),
  ];
  if (key) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO rejected_guesses (question_id, normalized, count, closest_answer_id, distance, last_seen)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(question_id, normalized) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen`,
      ).bind(qid, normalize(text), closest?.answerId ?? null, closest?.distance ?? null, now),
    );
  }
  await env.DB.batch(stmts);
  s.penalties += 1;
  await settle(env, s, now);
  return { ...result, endsAt: endsAt(s), serverNow: now, questionDone: !!s.current_done };
}

export async function reveal(env: Env, playerId: string, id: string, index: number, now: number): Promise<RevealResponse> {
  const s = await loadSession(env, id, playerId);
  await settle(env, s, now);
  const done = index < s.current_index || (index === s.current_index && !!s.current_done);
  if (!done) throw new HttpError(403, "Answers are revealed once the question is over");
  const ids = JSON.parse(s.question_ids) as string[];
  const qid = ids[index];
  if (!qid) throw new HttpError(404, "No such question");
  const qIndex = await getIndex(env, qid);
  const q = (await getQuestions(env, [qid])).get(qid)!;
  const play = await env.DB.prepare("SELECT answer_id FROM plays WHERE session_id = ? AND idx = ?").bind(s.id, index).first<{ answer_id: string | null }>();
  return {
    index,
    prompt: q.prompt,
    answers: qIndex.answers.map((a) => ({ answerId: a.id, canonical: a.canonical, tier: a.tier })),
    playerAnswerId: play?.answer_id ?? null,
  };
}

export async function finish(env: Env, playerId: string, id: string, now: number): Promise<FinishResponse> {
  const s = await loadSession(env, id, playerId);
  await settle(env, s, now);
  const ids = JSON.parse(s.question_ids) as string[];
  const allDone = s.current_index === ids.length - 1 && !!s.current_done;
  if (!allDone && !s.finished) throw new HttpError(409, "The dive isn't over yet");

  const plays = await loadPlays(env, s.id);
  const points = plays.reduce((n, p) => n + p.points, 0);

  if (!s.finished) {
    await env.DB.prepare("UPDATE sessions SET finished = 1 WHERE id = ?").bind(s.id).run();
    if (s.mode === "daily" && s.date) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO daily_results (player_id, date, points, tiers, created_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(playerId, s.date, points, JSON.stringify(plays.map((p) => p.tier)), now)
        .run();
    }
  }

  const questions = await getQuestions(env, ids);
  let percentile: number | null = null;
  let divers: number | null = null;
  let rarest: FinishResponse["rarestToday"] = null;

  if (s.mode === "daily" && s.date) {
    const stats = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN points < ? THEN 1 ELSE 0 END) AS below
       FROM daily_results WHERE date = ? AND player_id != ?`,
    )
      .bind(points, s.date, playerId)
      .first<{ total: number; below: number }>();
    if (stats && stats.total + 1 >= PERCENTILE_MIN_RESULTS && stats.total > 0) {
      percentile = Math.round(((stats.below ?? 0) / stats.total) * 100);
      divers = stats.total + 1;
    }
    const r = await env.DB.prepare(
      `SELECT p.canonical, p.tier, q.prompt FROM plays p
       JOIN sessions s ON s.id = p.session_id
       JOIN questions q ON q.id = p.question_id
       WHERE s.mode = 'daily' AND s.date = ? AND p.tier IS NOT NULL
       ORDER BY p.tier DESC, p.created_at ASC LIMIT 1`,
    )
      .bind(s.date)
      .first<{ canonical: string; tier: TierPoints; prompt: string }>();
    if (r) rarest = { prompt: r.prompt, canonical: r.canonical, tier: r.tier };
  } else {
    for (const p of plays) {
      if (p.tier && p.canonical && (!rarest || p.tier > rarest.tier)) {
        rarest = { prompt: questions.get(p.question_id)?.prompt ?? "", canonical: p.canonical, tier: p.tier };
      }
    }
  }

  const depth = pointsToDepth(points);
  return {
    mode: s.mode,
    dailyNumber: s.date ? await dailyNumber(env, s.date) : null,
    totalPoints: points,
    depth,
    zone: zoneForDepth(depth).name,
    plays: plays.map((p) => toPlayRecord(p, questions.get(p.question_id)?.prompt ?? "")),
    percentile,
    divers,
    rarestToday: rarest,
    nextDailyAt: nextDailyResetAt(now),
  };
}

/**
 * "This should count": from a solo dive (session + question index) or from a
 * party game (by the prompt's exact text, since party rooms have no session).
 */
export async function report(env: Env, playerId: string, body: { sessionId?: string; index?: number; prompt?: string; guess?: string }, now: number) {
  const guessText = String(body.guess ?? "").trim().slice(0, 100);
  if (!guessText) throw new HttpError(400, "Missing report details");
  let qid: string | undefined;
  if (body.sessionId && body.index !== undefined) {
    const s = await loadSession(env, body.sessionId, playerId);
    qid = (JSON.parse(s.question_ids) as string[])[body.index];
  } else if (body.prompt) {
    qid = (await env.DB.prepare("SELECT id FROM questions WHERE prompt = ? ORDER BY status = 'retired' LIMIT 1").bind(String(body.prompt)).first<{ id: string }>())?.id;
  } else {
    throw new HttpError(400, "Missing report details");
  }
  if (!qid) throw new HttpError(400, "No such question");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE player_id = ? AND created_at > ?").bind(playerId, now - 86_400_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 60) throw new HttpError(429, "Thanks! That's plenty of reports for today.");
  await env.DB.prepare("INSERT INTO reports (question_id, guess, player_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(qid, guessText, playerId, now)
    .run();
  return { ok: true };
}

export async function categories(env: Env, now: number) {
  const [date, todays] = await unlimitedParams(env, now);
  const { results } = await env.DB.prepare(
    `SELECT category, COUNT(*) AS count FROM questions WHERE ${UNLIMITED_WHERE} GROUP BY category ORDER BY category`,
  )
    .bind(date, todays)
    .all<{ category: Category; count: number }>();
  return results;
}
