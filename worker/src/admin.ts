import { Hono } from "hono";
import {
  CATEGORIES,
  QUESTIONS_PER_DAY,
  SCHEDULE_BUFFER_DAYS,
  UNLIMITED_POOL_CAP,
  WEEKLY_UNLIMITED_QUESTIONS,
  addDays,
  buildGeneratePrompt,
  compact,
  normalize,
  normalizePrompt,
  serializeQuestion,
  validateQuestion,
} from "@fathom/shared";
import type { Category, ParsedFixes, ParsedQuestion, TierPoints } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { INDEX_KEY, UNLIMITED_WHERE, forgetIndex, getQuestion, parseContent, storeIndex, today, unlimitedParams } from "./questions";
import type { QuestionContent, QuestionRow, StoredAnswer } from "./questions";

/**
 * Admin API (Bearer ADMIN_TOKEN). Used by the /admin portal and the scripts
 * (status, import, export:rejected, pool:refresh) that the weekly task runs.
 *
 * Imports arrive one question per request: the browser or CLI does the heavy
 * parsing/validation first, so each Worker request stays inside the free
 * plan's small CPU budget.
 */

type AppEnv = { Bindings: Env };
export const adminRoutes = new Hono<AppEnv>();

/** Constant-time string compare so the token can't be guessed by timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

adminRoutes.use("/api/admin/*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) throw new HttpError(503, "ADMIN_TOKEN is not set on the server (run: npx wrangler secret put ADMIN_TOKEN)");
  const got = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(got, expected)) throw new HttpError(401, "Wrong admin token");
  await next();
});

// ---------------------------------------------------------------------------
// Status (for the weekly task and the portal)
// ---------------------------------------------------------------------------

async function scheduleMap(env: Env, from: string, days: number) {
  const to = addDays(from, days - 1);
  const { results } = await env.DB.prepare(
    "SELECT id, prompt, category, daily_date, daily_slot FROM questions WHERE daily_date BETWEEN ? AND ? AND status != 'retired' ORDER BY daily_date, daily_slot",
  )
    .bind(from, to)
    .all<{ id: string; prompt: string; category: Category; daily_date: string; daily_slot: number }>();
  const out: { date: string; slots: ({ id: string; prompt: string; category: Category } | null)[] }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const slots: ({ id: string; prompt: string; category: Category } | null)[] = Array(QUESTIONS_PER_DAY).fill(null);
    for (const r of results) if (r.daily_date === date) slots[r.daily_slot - 1] = { id: r.id, prompt: r.prompt, category: r.category };
    out.push({ date, slots });
  }
  return out;
}

async function poolSize(env: Env, now: number) {
  const [date, todays] = await unlimitedParams(env, now);
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM questions WHERE ${UNLIMITED_WHERE}`).bind(date, todays).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function adminStatus(env: Env, now: number) {
  const date = today(now);
  const schedule = await scheduleMap(env, addDays(date, 1), 28);
  const openDates = schedule.filter((d) => d.slots.some((s) => !s)).map((d) => ({
    date: d.date,
    openSlots: d.slots.map((s, i) => (s ? 0 : i + 1)).filter(Boolean),
  }));
  let filledAhead = 0;
  for (const d of schedule) {
    if (d.slots.every(Boolean)) filledAhead++;
    else break;
  }

  const { results: prompts } = await env.DB.prepare("SELECT id, prompt, category, status FROM questions ORDER BY id").all<{
    id: string;
    prompt: string;
    category: Category;
    status: string;
  }>();
  const { results: scheduled } = await env.DB.prepare(
    "SELECT id, daily_date AS date, daily_slot AS slot FROM questions WHERE daily_date >= ? AND status != 'retired'",
  )
    .bind(date)
    .all<{ id: string; date: string; slot: number }>();
  const { results: usage } = await env.DB.prepare(
    "SELECT category, COUNT(*) AS n FROM questions WHERE daily_date BETWEEN ? AND ? GROUP BY category",
  )
    .bind(addDays(date, -28), addDays(date, 28))
    .all<{ category: string; n: number }>();
  const counts = await env.DB.prepare(
    `SELECT SUM(status = 'reserve') AS reserve, SUM(status = 'retired') AS retired, SUM(status = 'unlimited') AS unlimited, COUNT(*) AS total FROM questions`,
  ).first<{ reserve: number; retired: number; unlimited: number; total: number }>();

  return {
    today: date,
    bufferDays: SCHEDULE_BUFFER_DAYS,
    filledDaysAhead: filledAhead,
    openDates,
    poolSize: await poolSize(env, now),
    poolCap: UNLIMITED_POOL_CAP,
    reserveCount: counts?.reserve ?? 0,
    retiredCount: counts?.retired ?? 0,
    totalQuestions: counts?.total ?? 0,
    categoryUsage: Object.fromEntries(CATEGORIES.map((c) => [c, usage.find((u) => u.category === c)?.n ?? 0])),
    prompts,
    scheduled,
    serverNow: now,
  };
}

adminRoutes.get("/api/admin/status", async (c) => c.json(await adminStatus(c.env, Date.now())));

adminRoutes.get("/api/admin/schedule", async (c) => {
  const days = Math.min(60, Number(c.req.query("days") ?? 21));
  return c.json(await scheduleMap(c.env, today(), days));
});

// ---------------------------------------------------------------------------
// Import / edit one question
// ---------------------------------------------------------------------------

type ImportMode = "file" | "fill" | "unlimited";

async function nextQuestionId(env: Env): Promise<string> {
  const r = await env.DB.prepare(
    "SELECT MAX(CAST(SUBSTR(id, 2) AS INTEGER)) AS n FROM questions WHERE id GLOB 'q[0-9]*'",
  ).first<{ n: number | null }>();
  return `q${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

async function nextOpenSlot(env: Env, now: number): Promise<{ date: string; slot: number }> {
  const start = addDays(today(now), 1);
  for (let chunk = 0; chunk < 12; chunk++) {
    const sched = await scheduleMap(env, addDays(start, chunk * 30), 30);
    for (const d of sched) {
      const i = d.slots.findIndex((s) => !s);
      if (i >= 0) return { date: d.date, slot: i + 1 };
    }
  }
  throw new HttpError(500, "No open Daily slots in the next year");
}

/** Keep answer IDs stable across edits: match by normalized canonical text. */
function assignAnswerIds(qid: string, answers: ParsedQuestion["answers"], previous?: StoredAnswer[]): StoredAnswer[] {
  const byKey = new Map((previous ?? []).map((a) => [compact(normalize(a.text)), a.id]));
  let next =
    (previous ?? []).reduce((m, a) => Math.max(m, Number(a.id.split("-a").pop()) || 0), -1) + 1;
  return answers.map((a) => {
    const id = byKey.get(compact(normalize(a.text))) ?? `${qid}-a${next++}`;
    return { id, text: a.text, tier: a.tier as TierPoints, ...(a.aliases?.length ? { aliases: a.aliases } : {}) };
  });
}

export async function upsertQuestion(
  env: Env,
  q: Omit<ParsedQuestion, "line">,
  opts: { mode?: ImportMode; replace?: boolean; source?: string },
  now: number,
) {
  const mode = opts.mode ?? "file";
  const existing = q.id ? await getQuestion(env, q.id) : null;
  if (q.id && !existing) throw new HttpError(404, `No question with id ${q.id}`);

  // Decide where it goes.
  let status: QuestionRow["status"] = existing?.status ?? "unlimited";
  let date: string | null = existing?.daily_date ?? null;
  let slot: number | null = existing?.daily_slot ?? null;
  if (mode === "unlimited") {
    status = "unlimited";
    date = null;
    slot = null;
  } else if (mode === "fill" && !existing) {
    ({ date, slot } = await nextOpenSlot(env, now));
    status = "scheduled";
  } else if (q.date && q.slot) {
    status = "scheduled";
    date = q.date;
    slot = q.slot;
  } else if (q.pool) {
    status = q.pool;
    date = null;
    slot = null;
  }
  if (status === "scheduled" && date && date <= today(now) && !existing) {
    throw new HttpError(400, `${q.prompt}: ${date} is today or in the past; schedule it for a future date`);
  }

  // Validate against what's already in the bank (cheap checks only; the client ran the full validator).
  const promptHit = await env.DB.prepare("SELECT id FROM questions WHERE prompt_key = ?").bind(normalizePrompt(q.prompt)).first<{ id: string }>();
  const slotHit =
    status === "scheduled" && date && slot
      ? await env.DB.prepare("SELECT id, daily_date FROM questions WHERE daily_date = ? AND daily_slot = ? AND status != 'retired'")
          .bind(date, slot)
          .first<{ id: string; daily_date: string }>()
      : null;
  const report = validateQuestion(
    { ...q, date: date ?? undefined, slot: slot ?? undefined },
    {
      existingPrompts: new Map(promptHit ? [[normalizePrompt(q.prompt), promptHit.id]] : []),
      takenSlots: new Map(slotHit && date && slot ? [[`${date}#${slot}`, slotHit.id]] : []),
      replace: opts.replace,
      skipFuzzyPairs: true,
    },
  );
  // A question that already aired can't be bumped by "replace".
  if (slotHit && slotHit.id !== existing?.id && opts.replace && slotHit.daily_date <= today(now)) {
    report.errors.push(`${date} slot ${slot} already aired`);
  }
  if (report.errors.length) return { ok: false as const, prompt: q.prompt, errors: report.errors, warnings: report.warnings };

  const id = existing?.id ?? (await nextQuestionId(env));
  const prev = existing ? parseContent(existing) : undefined;
  const content: QuestionContent = {
    answers: assignAnswerIds(id, q.answers, prev?.answers),
    nearMisses: q.nearMisses ?? [],
    ...(q.note ? { notes: q.note } : {}),
  };
  const data = JSON.stringify(content);

  const stmts: D1PreparedStatement[] = [];
  if (slotHit && slotHit.id !== id && opts.replace) {
    // The question being replaced moves to Unlimited rather than disappearing.
    stmts.push(env.DB.prepare("UPDATE questions SET status = 'unlimited', daily_date = NULL, daily_slot = NULL WHERE id = ?").bind(slotHit.id));
  }
  if (existing) {
    stmts.push(
      env.DB.prepare(
        `UPDATE questions SET prompt = ?, prompt_key = ?, category = ?, status = ?, daily_date = ?, daily_slot = ?, data = ?, answer_count = ? WHERE id = ?`,
      ).bind(q.prompt, normalizePrompt(q.prompt), q.category, status, date, slot, data, content.answers.length, id),
    );
  } else {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO questions (id, prompt, prompt_key, category, status, daily_date, daily_slot, source, data, answer_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, q.prompt, normalizePrompt(q.prompt), q.category, status, date, slot, opts.source ?? "paste", data, content.answers.length, now),
    );
  }
  await env.DB.batch(stmts);
  await storeIndex(env, { id, data, prompt: q.prompt });
  return { ok: true as const, id, prompt: q.prompt, status, date, slot, updated: !!existing, warnings: report.warnings };
}

adminRoutes.post("/api/admin/question", async (c) => {
  const body = await c.req.json<{ question: ParsedQuestion; mode?: ImportMode; replace?: boolean; source?: string }>();
  if (!body?.question) throw new HttpError(400, "Missing question");
  const result = await upsertQuestion(c.env, body.question, body, Date.now());
  return c.json(result, result.ok ? 200 : 422);
});

adminRoutes.get("/api/admin/question/:id", async (c) => {
  const row = await getQuestion(c.env, c.req.param("id"));
  if (!row) throw new HttpError(404, "Not found");
  const content = parseContent(row);
  const text = serializeQuestion({
    id: row.id,
    ...(row.status === "scheduled" && row.daily_date ? { date: row.daily_date, slot: row.daily_slot! } : {}),
    ...(row.status === "reserve" || row.status === "unlimited" ? { pool: row.status } : {}),
    category: row.category,
    prompt: row.prompt,
    note: content.notes,
    answers: content.answers,
    nearMisses: content.nearMisses,
  });
  return c.json({ id: row.id, status: row.status, date: row.daily_date, slot: row.daily_slot, plays: row.plays, text });
});

adminRoutes.delete("/api/admin/question/:id", async (c) => {
  const id = c.req.param("id");
  const row = await getQuestion(c.env, id);
  if (!row) throw new HttpError(404, "Not found");
  const aired = row.daily_date && row.daily_date <= today();
  if (row.plays > 0 || aired) {
    // Played questions are retired, never deleted (stats point at them).
    await c.env.DB.prepare("UPDATE questions SET status = 'retired', retired_at = ?, daily_date = CASE WHEN daily_date > ? THEN NULL ELSE daily_date END, daily_slot = CASE WHEN daily_date > ? THEN NULL ELSE daily_slot END WHERE id = ?")
      .bind(Date.now(), today(), today(), id)
      .run();
    return c.json({ ok: true, retired: true });
  }
  await c.env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
  await c.env.KV.delete(INDEX_KEY(id));
  forgetIndex(id);
  return c.json({ ok: true, deleted: true });
});

/** Swap two future Daily slots (either may be empty). */
adminRoutes.post("/api/admin/swap", async (c) => {
  const { a, b } = await c.req.json<{ a: { date: string; slot: number }; b: { date: string; slot: number } }>();
  const t = today();
  if (!a || !b || a.date <= t || b.date <= t) throw new HttpError(400, "Only future slots can be swapped");
  const qa = await c.env.DB.prepare("SELECT id FROM questions WHERE daily_date = ? AND daily_slot = ? AND status != 'retired'").bind(a.date, a.slot).first<{ id: string }>();
  const qb = await c.env.DB.prepare("SELECT id FROM questions WHERE daily_date = ? AND daily_slot = ? AND status != 'retired'").bind(b.date, b.slot).first<{ id: string }>();
  const stmts: D1PreparedStatement[] = [];
  // Park both first so the unique (date, slot) index never sees a clash.
  if (qa) stmts.push(c.env.DB.prepare("UPDATE questions SET daily_date = NULL, daily_slot = NULL WHERE id = ?").bind(qa.id));
  if (qb) stmts.push(c.env.DB.prepare("UPDATE questions SET daily_date = NULL, daily_slot = NULL WHERE id = ?").bind(qb.id));
  if (qa) stmts.push(c.env.DB.prepare("UPDATE questions SET daily_date = ?, daily_slot = ? WHERE id = ?").bind(b.date, b.slot, qa.id));
  if (qb) stmts.push(c.env.DB.prepare("UPDATE questions SET daily_date = ?, daily_slot = ? WHERE id = ?").bind(a.date, a.slot, qb.id));
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/** Take a future question off the schedule and put it in Unlimited. */
adminRoutes.post("/api/admin/unschedule", async (c) => {
  const { id } = await c.req.json<{ id: string }>();
  await c.env.DB.prepare("UPDATE questions SET status = 'unlimited', daily_date = NULL, daily_slot = NULL WHERE id = ? AND daily_date > ?")
    .bind(id, today())
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// FIXES (learning loop)
// ---------------------------------------------------------------------------

export async function applyFixes(env: Env, f: Omit<ParsedFixes, "line">, now: number) {
  const row = await getQuestion(env, f.questionId);
  if (!row) return { ok: false as const, questionId: f.questionId, errors: [`No question with id ${f.questionId}`] };
  const content = parseContent(row);
  const errors: string[] = [];
  const keyOf = (s: string) => compact(normalize(s));

  for (const a of f.aliases) {
    const target = content.answers.find((x) => keyOf(x.text) === keyOf(a.answer));
    if (!target) {
      errors.push(`alias: no answer "${a.answer}"`);
      continue;
    }
    const have = new Set([target.text, ...(target.aliases ?? [])].map(keyOf));
    target.aliases = [...(target.aliases ?? []), ...a.aliases.filter((x) => !have.has(keyOf(x)))];
  }
  let next = content.answers.reduce((m, a) => Math.max(m, Number(a.id.split("-a").pop()) || 0), -1) + 1;
  for (const a of f.adds) {
    if (content.answers.some((x) => keyOf(x.text) === keyOf(a.text))) {
      errors.push(`add: "${a.text}" already exists`);
      continue;
    }
    content.answers.push({ id: `${row.id}-a${next++}`, text: a.text, tier: a.tier, ...(a.aliases.length ? { aliases: a.aliases } : {}) });
  }
  const misses = new Set(content.nearMisses.map(keyOf));
  for (const r of f.rejects) if (!misses.has(keyOf(r))) content.nearMisses.push(r);

  const report = validateQuestion(
    { prompt: row.prompt, category: row.category, answers: content.answers, nearMisses: content.nearMisses },
    { skipFuzzyPairs: true },
  );
  errors.push(...report.errors);
  if (errors.length) return { ok: false as const, questionId: row.id, errors };

  const data = JSON.stringify(content);
  await env.DB.batch([
    env.DB.prepare("UPDATE questions SET data = ?, answer_count = ? WHERE id = ?").bind(data, content.answers.length, row.id),
    // Everything the export showed for this question has now been handled.
    env.DB.prepare("UPDATE rejected_guesses SET resolved = 1 WHERE question_id = ? AND count >= 2").bind(row.id),
    env.DB.prepare("UPDATE reports SET status = 'resolved' WHERE question_id = ? AND status = 'open'").bind(row.id),
  ]);
  await storeIndex(env, { id: row.id, data, prompt: row.prompt });
  return {
    ok: true as const,
    questionId: row.id,
    aliasesAdded: f.aliases.length,
    answersAdded: f.adds.length,
    rejectsAdded: f.rejects.length,
    at: now,
  };
}

adminRoutes.post("/api/admin/fixes", async (c) => {
  const { fixes } = await c.req.json<{ fixes: ParsedFixes }>();
  if (!fixes?.questionId) throw new HttpError(400, "Missing fixes");
  const result = await applyFixes(c.env, fixes, Date.now());
  return c.json(result, result.ok ? 200 : 422);
});

// ---------------------------------------------------------------------------
// Review (learning loop export)
// ---------------------------------------------------------------------------

async function reviewData(env: Env) {
  const { results: rejected } = await env.DB.prepare(
    `SELECT r.question_id, r.normalized, r.count, r.closest_answer_id, r.distance, q.prompt, q.data
     FROM rejected_guesses r JOIN questions q ON q.id = r.question_id
     WHERE r.count >= 2 AND r.resolved = 0
     ORDER BY r.question_id, r.count DESC LIMIT 2000`,
  ).all<{ question_id: string; normalized: string; count: number; closest_answer_id: string | null; distance: number | null; prompt: string; data: string }>();
  const { results: reports } = await env.DB.prepare(
    `SELECT r.id, r.question_id, r.guess, r.created_at, q.prompt FROM reports r JOIN questions q ON q.id = r.question_id
     WHERE r.status = 'open' ORDER BY r.question_id, r.created_at LIMIT 1000`,
  ).all<{ id: number; question_id: string; guess: string; created_at: number; prompt: string }>();

  const answerText = new Map<string, string>();
  for (const r of rejected) {
    if (!answerText.size || !answerText.has(r.closest_answer_id ?? "")) {
      for (const a of (JSON.parse(r.data) as QuestionContent).answers) answerText.set(a.id, a.text);
    }
  }
  return {
    rejected: rejected.map((r) => ({
      questionId: r.question_id,
      prompt: r.prompt,
      guess: r.normalized,
      count: r.count,
      closest: r.closest_answer_id ? answerText.get(r.closest_answer_id) ?? null : null,
      distance: r.distance,
    })),
    reports: reports.map((r) => ({ id: r.id, questionId: r.question_id, prompt: r.prompt, guess: r.guess, at: r.created_at })),
  };
}

export function formatRejectedExport(data: Awaited<ReturnType<typeof reviewData>>): string {
  const byQ = new Map<string, { prompt: string; lines: string[] }>();
  const add = (qid: string, prompt: string, line: string) => {
    if (!byQ.has(qid)) byQ.set(qid, { prompt, lines: [] });
    byQ.get(qid)!.lines.push(line);
  };
  for (const r of data.rejected) {
    add(r.questionId, r.prompt, `- "${r.guess}" ×${r.count}${r.closest ? ` (closest: ${r.closest}, distance ${r.distance})` : ""}`);
  }
  for (const r of data.reports) add(r.questionId, r.prompt, `- REPORTED "this should count": "${r.guess}"`);

  const head = [
    "REJECTED GUESSES AND REPORTS",
    "For each item, decide: (a) a misspelling/alias of an existing answer, (b) a valid missing answer (pick a tier), or (c) invalid.",
    "Reply ONLY with FIXES blocks in this exact format, one block per question that needs changes:",
    "",
    "# FIXES",
    "question: q0142",
    "alias: Existing Answer | new alias",
    "add: Tier Name | New Answer | optional alias",
    "reject: invalid guess people keep trying",
    "",
    "Tier names: One in a Krillion, Deep Cut, Rare, Schooler, Too Clever, Plankton. Leave out guesses that are simply wrong and not worth blocking.",
    "",
  ];
  if (byQ.size === 0) return head.join("\n") + "(Nothing to review right now.)\n";
  const body = [...byQ.entries()].map(([qid, v]) => `## ${qid}: ${v.prompt}\n${v.lines.join("\n")}`);
  return head.join("\n") + body.join("\n\n") + "\n";
}

adminRoutes.get("/api/admin/review", async (c) => c.json(await reviewData(c.env)));
adminRoutes.get("/api/admin/rejected-export", async (c) => {
  const text = formatRejectedExport(await reviewData(c.env));
  return c.text(text);
});
adminRoutes.post("/api/admin/reports/:id/resolve", async (c) => {
  await c.env.DB.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

/**
 * Keep the active Unlimited pool at UNLIMITED_POOL_CAP by retiring the
 * oldest, most-played questions. Retired questions are never deleted; once the
 * pool has room again, the least-recently-retired ones come back.
 */
export async function poolRefresh(env: Env, now: number) {
  const size = await poolSize(env, now);
  const [date, todays] = await unlimitedParams(env, now);
  if (size > UNLIMITED_POOL_CAP) {
    const excess = size - UNLIMITED_POOL_CAP;
    const res = await env.DB.prepare(
      `UPDATE questions SET status = 'retired', retired_at = ?3
       WHERE id IN (SELECT id FROM questions WHERE ${UNLIMITED_WHERE} ORDER BY created_at ASC, plays DESC LIMIT ?4)`,
    )
      .bind(date, todays, now, excess)
      .run();
    return { before: size, retired: res.meta.changes, restored: 0, after: size - res.meta.changes, cap: UNLIMITED_POOL_CAP };
  }
  const room = UNLIMITED_POOL_CAP - size;
  // Bring back questions retired at least 180 days ago, oldest retirement first.
  const res = await env.DB.prepare(
    `UPDATE questions SET status = 'unlimited', retired_at = NULL
     WHERE id IN (SELECT id FROM questions WHERE status = 'retired' AND retired_at < ? AND answer_count >= 50 ORDER BY retired_at ASC LIMIT ?)`,
  )
    .bind(now - 180 * 86_400_000, room)
    .run();
  return { before: size, retired: 0, restored: res.meta.changes, after: size + res.meta.changes, cap: UNLIMITED_POOL_CAP };
}

adminRoutes.post("/api/admin/pool-refresh", async (c) => c.json(await poolRefresh(c.env, Date.now())));

adminRoutes.get("/api/admin/pool", async (c) => {
  const now = Date.now();
  const [date, todays] = await unlimitedParams(c.env, now);
  const { results: active } = await c.env.DB.prepare(
    `SELECT id, prompt, category, plays, answer_count, created_at FROM questions WHERE ${UNLIMITED_WHERE} ORDER BY plays DESC LIMIT 3000`,
  )
    .bind(date, todays)
    .all<{ id: string; prompt: string; category: string; plays: number; answer_count: number; created_at: number }>();
  const { results: retired } = await c.env.DB.prepare(
    "SELECT id, prompt, category, plays, retired_at FROM questions WHERE status = 'retired' ORDER BY retired_at DESC LIMIT 1000",
  ).all();
  const { results: accuracy } = await c.env.DB.prepare(
    `SELECT question_id, COUNT(*) AS plays, SUM(answer_id IS NOT NULL) AS hits, AVG(points) AS avg_points
     FROM plays GROUP BY question_id`,
  ).all<{ question_id: string; plays: number; hits: number; avg_points: number }>();
  const acc = new Map(accuracy.map((a) => [a.question_id, a]));
  return c.json({
    poolSize: active.length,
    cap: UNLIMITED_POOL_CAP,
    active: active.map((q) => ({
      ...q,
      hitRate: acc.get(q.id) ? Math.round((acc.get(q.id)!.hits / acc.get(q.id)!.plays) * 100) : null,
      avgPoints: acc.get(q.id) ? Math.round(acc.get(q.id)!.avg_points) : null,
    })),
    retired,
  });
});

// ---------------------------------------------------------------------------
// Generate tab: a ready-to-copy prompt for a normal Claude chat
// ---------------------------------------------------------------------------

adminRoutes.get("/api/admin/generate-prompt", async (c) => {
  const status = await adminStatus(c.env, Date.now());
  const days = Math.min(14, Number(c.req.query("days") ?? 7));
  const unlimited = Math.min(200, Number(c.req.query("unlimited") ?? WEEKLY_UNLIMITED_QUESTIONS));
  const text = buildGeneratePrompt({
    openDates: status.openDates.slice(0, days),
    existingPrompts: status.prompts.map((p) => p.prompt),
    categoryUsage: status.categoryUsage,
    unlimitedCount: unlimited,
  });
  return c.text(text);
});

// ---------------------------------------------------------------------------
// Re-tiering suggestions from real data (questions with 300+ plays)
// ---------------------------------------------------------------------------

adminRoutes.get("/api/admin/retier", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, prompt, data, plays FROM questions WHERE plays >= 300 ORDER BY plays DESC LIMIT 100").all<{
    id: string;
    prompt: string;
    data: string;
    plays: number;
  }>();
  const out = [];
  for (const q of results) {
    const content = parseContent(q);
    const { results: stats } = await c.env.DB.prepare("SELECT answer_id, times_chosen FROM answer_stats WHERE question_id = ?")
      .bind(q.id)
      .all<{ answer_id: string; times_chosen: number }>();
    out.push({ id: q.id, prompt: q.prompt, plays: q.plays, suggestions: retierSuggestions(content.answers, stats) });
  }
  return c.json(out.filter((q) => q.suggestions.length));
});

/** Suggest tiers from how often each answer was actually given (share of accepted answers). */
export function retierSuggestions(answers: StoredAnswer[], stats: { answer_id: string; times_chosen: number }[]) {
  const total = stats.reduce((n, s) => n + s.times_chosen, 0);
  if (total < 100) return [];
  const share = new Map(stats.map((s) => [s.answer_id, s.times_chosen / total]));
  const suggest = (p: number): TierPoints => (p >= 0.08 ? 10 : p >= 0.03 ? 30 : p >= 0.008 ? 60 : 85);
  const out: { answerId: string; text: string; current: TierPoints; suggested: TierPoints; share: number }[] = [];
  for (const a of answers) {
    if (a.tier === 100 || a.tier === 15) continue; // hand-picked tiers stay hand-picked
    const p = share.get(a.id) ?? 0;
    const s = suggest(p);
    if (s !== a.tier) out.push({ answerId: a.id, text: a.text, current: a.tier, suggested: s, share: Math.round(p * 1000) / 10 });
  }
  return out.sort((x, y) => y.share - x.share).slice(0, 25);
}
