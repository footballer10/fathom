import type { Hono } from "hono";
import { HttpError } from "./env";
import type { Env } from "./env";
import { getQuestions } from "./questions";
import { ensureSchema, lbStatsStatements } from "./schema";
import { ensureRewards } from "./rewards";
import { clearLeaderboardCache } from "./leaderboards";
import { banPlayer, listBans, unbanPlayer } from "./bans";

/**
 * Admin: see every dive one player has taken, and remove any of them from the
 * records (for players caught cheating). Removing a dive deletes its score,
 * rebuilds that player's leaderboard row from what's left, fixes the Daily score
 * curve and that day's rarest answer, and clears the leaderboard cache. A
 * removed Daily or Abyss attempt stays "used", so it can't be replayed for a
 * fresh score. Every removal is written to removed_dives.
 */

type AppEnv = { Bindings: Env };

export type DiveKind = "daily" | "unlimited" | "archive" | "quick" | "party" | "abyss";

export interface DiveAnswer {
  prompt: string;
  canonical: string | null;
  tier: number | null;
  seconds: number | null;
}

export interface Dive {
  kind: DiveKind;
  /** What identifies it for removal (session id, run id, party row id, Abyss week). */
  ref: string;
  at: number;
  title: string;
  score: string;
  answers: DiveAnswer[];
  /** Average seconds per accepted answer, when known (very fast rare answers stand out). */
  avgSeconds: number | null;
}

let ready = false;
async function ensureRemovedLog(env: Env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS removed_dives (
       id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
       summary TEXT NOT NULL, pearls_taken INTEGER NOT NULL DEFAULT 0, removed_at INTEGER NOT NULL)`,
  ).run();
  ready = true;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

async function listDives(env: Env, playerId: string): Promise<Dive[]> {
  const db = env.DB;
  await ensureSchema(env);
  const [sessions, plays, runs, party, abyss] = await db.batch([
    db.prepare("SELECT id, mode, date, finished, created_at FROM sessions WHERE player_id = ? ORDER BY created_at DESC LIMIT 80").bind(playerId),
    db.prepare(
      `SELECT p.session_id, p.idx, p.question_id, p.canonical, p.tier, p.points, p.ms_used FROM plays p
       WHERE p.session_id IN (SELECT id FROM sessions WHERE player_id = ? ORDER BY created_at DESC LIMIT 80) ORDER BY p.session_id, p.idx`,
    ).bind(playerId),
    db.prepare("SELECT id, mode, started_at, finished, score, data FROM practice_runs WHERE player_id = ? ORDER BY started_at DESC LIMIT 40").bind(playerId),
    db.prepare("SELECT id, kind, variant, rank, player_count, score, finished_at FROM party_results WHERE player_id = ? ORDER BY finished_at DESC LIMIT 40").bind(playerId),
    db.prepare("SELECT week, question_id, started_at, best_tier, best_answer, best_at, answers FROM abyss_attempts WHERE player_id = ? ORDER BY started_at DESC LIMIT 12").bind(playerId),
  ]);

  type PlayRow = { session_id: string; idx: number; question_id: string; canonical: string | null; tier: number | null; points: number; ms_used: number };
  type RunRow = { id: string; mode: string; started_at: number; finished: number; score: number | null; data: string };
  type AbyssRow = { week: string; question_id: string; started_at: number; best_tier: number | null; best_answer: string | null; best_at: number | null; answers: string };
  const playRows = plays.results as PlayRow[];
  const runRows = runs.results as RunRow[];
  const abyssRows = abyss.results as AbyssRow[];

  // Prompts for every question shown.
  const qids = new Set<string>(playRows.map((p) => p.question_id));
  for (const r of runRows) for (const a of (JSON.parse(r.data) as { accepted?: { qid: string }[] }).accepted ?? []) qids.add(a.qid);
  for (const a of abyssRows) qids.add(a.question_id);
  const qs = await getQuestions(env, [...qids]);
  const prompt = (id: string) => qs.get(id)?.prompt ?? id;
  /** An answer's name from its id (quick-mode runs store ids, not names). */
  const answerName = (qid: string, answerId: string) => {
    try {
      const list = (JSON.parse(qs.get(qid)?.data ?? "{}") as { answers?: { id: string; text: string }[] }).answers ?? [];
      return list.find((a) => a.id === answerId)?.text ?? answerId;
    } catch {
      return answerId;
    }
  };

  const bySession = new Map<string, PlayRow[]>();
  for (const p of playRows) bySession.set(p.session_id, [...(bySession.get(p.session_id) ?? []), p]);

  const out: Dive[] = [];
  for (const s of sessions.results as { id: string; mode: string; date: string | null; finished: number; created_at: number }[]) {
    const ps = bySession.get(s.id) ?? [];
    if (!ps.length && s.mode === "daily" && s.finished) continue; // already removed
    const pts = ps.reduce((n, p) => n + p.points, 0);
    const kind: DiveKind = s.mode === "daily" ? "daily" : s.mode === "archive" ? "archive" : "unlimited";
    out.push({
      kind,
      ref: s.id,
      at: s.created_at,
      title: kind === "daily" ? `Daily ${s.date}` : kind === "archive" ? `Archive Daily ${s.date}` : "Unlimited dive",
      score: `${(pts * 10).toLocaleString("en-US")} m${s.finished ? "" : " (not finished)"}`,
      answers: ps.map((p) => ({ prompt: prompt(p.question_id), canonical: p.canonical, tier: p.tier, seconds: Math.round(p.ms_used / 100) / 10 })),
      avgSeconds: avg(ps.filter((p) => p.canonical).map((p) => p.ms_used / 1000)),
    });
  }
  for (const r of runRows) {
    const d = JSON.parse(r.data) as { questions?: { id: string; at: number }[]; accepted?: { qid: string; tier: number; at: number; answerId: string }[] };
    const shownAt = new Map((d.questions ?? []).map((q) => [q.id, q.at]));
    const answers = (d.accepted ?? []).map((a) => {
      const from = shownAt.get(a.qid);
      return { prompt: prompt(a.qid), canonical: answerName(a.qid, a.answerId), tier: a.tier, seconds: from ? Math.round((a.at - from) / 100) / 10 : null };
    });
    out.push({
      kind: "quick",
      ref: r.id,
      at: r.started_at,
      title: `Quick mode: ${r.mode}`,
      score: r.finished ? `score ${r.score ?? 0}` : "not finished",
      answers,
      avgSeconds: avg(answers.map((a) => a.seconds).filter((x): x is number => x !== null)),
    });
  }
  for (const r of party.results as { id: number; kind: string; variant: string | null; rank: number; player_count: number; score: number; finished_at: number }[]) {
    out.push({
      kind: "party",
      ref: String(r.id),
      at: r.finished_at,
      title: `Party ${r.kind}${r.variant && r.variant !== "classic" ? ` (${r.variant})` : ""}`,
      score: `placed ${r.rank} of ${r.player_count}`,
      answers: [],
      avgSeconds: null,
    });
  }
  for (const a of abyssRows) {
    const answers = (JSON.parse(a.answers) as { canonical: string; tier: number }[]).map((x) => ({ prompt: prompt(a.question_id), canonical: x.canonical, tier: x.tier, seconds: null }));
    out.push({
      kind: "abyss",
      ref: a.week,
      at: a.started_at,
      title: `Weekly Abyss ${a.week}`,
      score: a.best_answer ? `best "${a.best_answer}"` : "no answer",
      answers,
      avgSeconds: a.best_at ? Math.round((a.best_at - a.started_at) / 100) / 10 : null,
    });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** Take a dive out of the records. Returns a one-line summary for the log. */
async function removeDive(env: Env, playerId: string, kind: DiveKind, ref: string, takePearls: boolean, now: number) {
  const db = env.DB;
  await ensureSchema(env);
  await ensureRewards(env);
  await ensureRemovedLog(env);
  const stmts: D1PreparedStatement[] = [];
  /** Reward keys this dive paid out (to take the pearls back). */
  const rewardKeys: string[] = [];
  let summary = "";

  if (kind === "daily" || kind === "unlimited" || kind === "archive") {
    const s = await db.prepare("SELECT id, mode, date FROM sessions WHERE id = ? AND player_id = ?").bind(ref, playerId).first<{ id: string; mode: string; date: string | null }>();
    if (!s) throw new HttpError(404, "No such dive for this player");
    const pts = (await db.prepare("SELECT COALESCE(SUM(points), 0) AS p FROM plays WHERE session_id = ?").bind(s.id).first<{ p: number }>())?.p ?? 0;
    summary = `${s.mode} ${s.date ?? ""} ${pts * 10} m`.replace(/\s+/g, " ");
    stmts.push(db.prepare("DELETE FROM plays WHERE session_id = ?").bind(s.id));
    if (s.mode === "daily" && s.date) {
      const r = await db.prepare("SELECT points FROM daily_results WHERE player_id = ? AND date = ?").bind(playerId, s.date).first<{ points: number }>();
      stmts.push(db.prepare("DELETE FROM daily_results WHERE player_id = ? AND date = ?").bind(playerId, s.date));
      if (r) {
        stmts.push(
          db.prepare("UPDATE daily_hist SET n = n - 1 WHERE date = ? AND points = ?").bind(s.date, r.points),
          db.prepare("DELETE FROM daily_hist WHERE date = ? AND n <= 0").bind(s.date),
        );
      }
      // That day's rarest answer, from the plays that are left (this dive's are deleted above).
      stmts.push(
        db.prepare("DELETE FROM daily_rarest WHERE date = ?").bind(s.date),
        db.prepare(
          `INSERT OR IGNORE INTO daily_rarest (date, tier, canonical, question_id, created_at)
           SELECT s.date, p.tier, p.canonical, p.question_id, p.created_at FROM plays p JOIN sessions s ON s.id = p.session_id
           WHERE s.mode = 'daily' AND s.date = ? AND p.tier IS NOT NULL AND p.canonical IS NOT NULL
           ORDER BY p.tier DESC, p.created_at ASC LIMIT 1`,
        ).bind(s.date),
      );
      // The session stays (finished, with no answers) so today's Daily can't be played again.
      stmts.push(db.prepare("UPDATE sessions SET finished = 1, current_done = 1 WHERE id = ?").bind(s.id));
      rewardKeys.push(`daily:${s.date}`);
    } else {
      stmts.push(db.prepare("DELETE FROM sessions WHERE id = ?").bind(s.id));
      rewardKeys.push(`unl:${s.id}`);
    }
  } else if (kind === "quick") {
    const r = await db.prepare("SELECT mode, score FROM practice_runs WHERE id = ? AND player_id = ?").bind(ref, playerId).first<{ mode: string; score: number | null }>();
    if (!r) throw new HttpError(404, "No such run for this player");
    summary = `quick ${r.mode} score ${r.score ?? 0}`;
    stmts.push(db.prepare("DELETE FROM practice_runs WHERE id = ?").bind(ref));
    rewardKeys.push(`run:${ref}`);
  } else if (kind === "party") {
    const r = await db
      .prepare("SELECT kind, room, rank, player_count, finished_at FROM party_results WHERE id = ? AND player_id = ?")
      .bind(Number(ref), playerId)
      .first<{ kind: string; room: string; rank: number; player_count: number; finished_at: number }>();
    if (!r) throw new HttpError(404, "No such party game for this player");
    summary = `party ${r.kind} placed ${r.rank} of ${r.player_count}`;
    stmts.push(db.prepare("DELETE FROM party_results WHERE id = ?").bind(Number(ref)));
    rewardKeys.push(`party:${r.room}:${r.finished_at}`);
  } else if (kind === "abyss") {
    const a = await db.prepare("SELECT best_answer FROM abyss_attempts WHERE week = ? AND player_id = ?").bind(ref, playerId).first<{ best_answer: string | null }>();
    if (!a) throw new HttpError(404, "No such Abyss dive for this player");
    summary = `abyss ${ref} ${a.best_answer ?? "no answer"}`;
    // Kept as a used attempt (so it can't be retaken this week), with its answers wiped.
    stmts.push(db.prepare("UPDATE abyss_attempts SET best_tier = NULL, best_answer = NULL, best_at = NULL, answers = '[]' WHERE week = ? AND player_id = ?").bind(ref, playerId));
    rewardKeys.push(`abyss:${ref}`, `abyssk:${ref}`);
  } else {
    throw new HttpError(400, "Unknown dive type");
  }

  // Take back the pearls it paid (the claim rows stay, so it can't pay again).
  let pearlsTaken = 0;
  if (takePearls && rewardKeys.length) {
    const { results } = await db
      .prepare("SELECT COALESCE(SUM(pearls), 0) AS p FROM reward_claims WHERE player_id = ? AND key IN (SELECT value FROM json_each(?))")
      .bind(playerId, JSON.stringify(rewardKeys))
      .all<{ p: number }>();
    pearlsTaken = results[0]?.p ?? 0;
    if (pearlsTaken > 0) {
      stmts.push(
        db.prepare("UPDATE wallet SET pearls = MAX(0, pearls - ?), lifetime = MAX(0, lifetime - ?) WHERE player_id = ?").bind(pearlsTaken, pearlsTaken, playerId),
      );
    }
  }

  // Rebuild this player's leaderboard row from what's left, and log the removal.
  stmts.push(
    ...lbStatsStatements(env, playerId),
    db.prepare("INSERT INTO removed_dives (player_id, kind, ref, summary, pearls_taken, removed_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      playerId,
      kind,
      ref,
      summary,
      pearlsTaken,
      now,
    ),
  );
  await db.batch(stmts);
  await clearLeaderboardCache(env);
  return { summary, pearlsTaken };
}

export function registerAdminDives(routes: Hono<AppEnv>) {
  routes.get("/api/admin/player/:id/dives", async (c) => {
    const id = c.req.param("id");
    await ensureRemovedLog(c.env);
    const removed = await c.env.DB.prepare("SELECT kind, ref, summary, pearls_taken, removed_at FROM removed_dives WHERE player_id = ? ORDER BY removed_at DESC LIMIT 50")
      .bind(id)
      .all();
    return c.json({ dives: await listDives(c.env, id), removed: removed.results });
  });

  routes.post("/api/admin/ban", async (c) => {
    const body = await c.req.json<{ playerId?: string; reason?: string }>().catch(() => ({}) as Record<string, never>);
    if (!body.playerId) throw new HttpError(400, "Missing player");
    return c.json({ ok: true, ...(await banPlayer(c.env, body.playerId, String(body.reason ?? "").trim(), Date.now())) });
  });

  routes.get("/api/admin/bans", async (c) => c.json({ bans: await listBans(c.env) }));

  routes.post("/api/admin/unban", async (c) => {
    const body = await c.req.json<{ playerId?: string }>().catch(() => ({}) as Record<string, never>);
    if (!body.playerId) throw new HttpError(400, "Missing player");
    await unbanPlayer(c.env, body.playerId);
    return c.json({ ok: true });
  });

  routes.post("/api/admin/remove-dive", async (c) => {
    const body = await c.req.json<{ playerId?: string; kind?: DiveKind; ref?: string; takePearls?: boolean }>().catch(() => ({}) as Record<string, never>);
    if (!body.playerId || !body.kind || !body.ref) throw new HttpError(400, "Missing player, dive type or dive id");
    const r = await removeDive(c.env, body.playerId, body.kind, String(body.ref), body.takePearls !== false, Date.now());
    return c.json({ ok: true, ...r, dives: await listDives(c.env, body.playerId) });
  });
}
