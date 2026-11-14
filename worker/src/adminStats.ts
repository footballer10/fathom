import type { Hono } from "hono";
import { HttpError } from "./env";
import { ensureRewards, earnStatements } from "./rewards";
import { banOf } from "./bans";
import { ITEM_BY_ID } from "@fathom/shared";
import type { Env } from "./env";
import { getDailySet, getQuestions, today } from "./questions";
import { ensureSchema } from "./schema";

/**
 * Read-only stats for the admin portal: who's playing, how recent Dailies went,
 * and which questions players struggle with. Only the owner (Bearer ADMIN_TOKEN)
 * can call these, and they're opened a few times a week, so they may scan more
 * rows than player-facing pages do.
 */

type AppEnv = { Bindings: Env };

const DAY = 86_400_000;
/** Start of a YYYY-MM-DD day in Mountain time (UTC-7), the site's Daily clock. */
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) + 7 * 3_600_000;
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

interface PlayerRow {
  id: string;
  nickname: string | null;
  username: string | null;
  joined: number;
  lastActive: number;
  dailies: number;
  dailyAvg: number | null;
  unlimitedRuns: number;
  quickRuns: number;
  partyGames: number;
  partyWins: number;
  abyss: number;
}

export function registerAdminStats(routes: Hono<AppEnv>) {
  /** Everyone who played between two dates (Mountain time), with what they did. */
  routes.get("/api/admin/players", async (c) => {
    const to = isDate(c.req.query("to")) ? c.req.query("to")! : today();
    const from = isDate(c.req.query("from")) ? c.req.query("from")! : addDays(to, -6);
    if (from > to) throw new HttpError(400, "'from' is after 'to'");
    await ensureSchema(c.env);
    const a = dayStart(from);
    const b = dayStart(to) + DAY;
    const db = c.env.DB;
    const [sessions, daily, practice, party, abyss] = await db.batch([
      db.prepare(
        `SELECT player_id, mode, COUNT(*) AS n, MAX(created_at) AS last FROM sessions
         WHERE created_at >= ?1 AND created_at < ?2 AND mode IN ('daily','unlimited','archive') GROUP BY player_id, mode`,
      ).bind(a, b),
      db.prepare("SELECT player_id, COUNT(*) AS n, AVG(points) AS avg FROM daily_results WHERE date BETWEEN ?1 AND ?2 GROUP BY player_id").bind(from, to),
      db.prepare(
        "SELECT player_id, COUNT(*) AS n, MAX(started_at) AS last FROM practice_runs WHERE started_at >= ?1 AND started_at < ?2 GROUP BY player_id",
      ).bind(a, b),
      db.prepare(
        "SELECT player_id, COUNT(*) AS n, SUM(rank = 1) AS wins, MAX(finished_at) AS last FROM party_results WHERE finished_at >= ?1 AND finished_at < ?2 GROUP BY player_id",
      ).bind(a, b),
      db.prepare("SELECT player_id, COUNT(*) AS n, MAX(started_at) AS last FROM abyss_attempts WHERE started_at >= ?1 AND started_at < ?2 GROUP BY player_id").bind(a, b),
    ]);
    const by = new Map<string, PlayerRow>();
    const get = (id: string) => {
      let p = by.get(id);
      if (!p) {
        p = { id, nickname: null, username: null, joined: 0, lastActive: 0, dailies: 0, dailyAvg: null, unlimitedRuns: 0, quickRuns: 0, partyGames: 0, partyWins: 0, abyss: 0 };
        by.set(id, p);
      }
      return p;
    };
    for (const r of sessions.results as { player_id: string; mode: string; n: number; last: number }[]) {
      const p = get(r.player_id);
      if (r.mode === "unlimited") p.unlimitedRuns += r.n;
      p.lastActive = Math.max(p.lastActive, r.last);
    }
    for (const r of daily.results as { player_id: string; n: number; avg: number }[]) {
      const p = get(r.player_id);
      p.dailies = r.n;
      p.dailyAvg = Math.round(r.avg * 10); // in metres
    }
    for (const r of practice.results as { player_id: string; n: number; last: number }[]) {
      const p = get(r.player_id);
      p.quickRuns = r.n;
      p.lastActive = Math.max(p.lastActive, r.last);
    }
    for (const r of party.results as { player_id: string; n: number; wins: number; last: number }[]) {
      const p = get(r.player_id);
      p.partyGames = r.n;
      p.partyWins = r.wins;
      p.lastActive = Math.max(p.lastActive, r.last);
    }
    for (const r of abyss.results as { player_id: string; n: number; last: number }[]) {
      const p = get(r.player_id);
      p.abyss = r.n;
      p.lastActive = Math.max(p.lastActive, r.last);
    }
    const ids = [...by.keys()];
    // Names, join dates and usernames for everyone active (in chunks, to stay under SQL limits).
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = JSON.stringify(ids.slice(i, i + 90));
      const names = await db.prepare("SELECT id, nickname, created_at FROM players WHERE id IN (SELECT value FROM json_each(?))").bind(chunk).all();
      // The accounts table only exists once someone has made an account.
      const accounts = await db
        .prepare("SELECT player_id, username FROM accounts WHERE player_id IN (SELECT value FROM json_each(?))")
        .bind(chunk)
        .all()
        .catch(() => ({ results: [] }));
      for (const r of names.results as { id: string; nickname: string | null; created_at: number }[]) {
        const p = by.get(r.id)!;
        p.nickname = r.nickname;
        p.joined = r.created_at;
      }
      for (const r of accounts.results as { player_id: string; username: string }[]) by.get(r.player_id)!.username = r.username;
    }
    const players = [...by.values()].sort((x, y) => y.lastActive - x.lastActive);
    const sum = (k: keyof PlayerRow) => players.reduce((n, p) => n + (Number(p[k]) || 0), 0);
    return c.json({
      from,
      to,
      totals: {
        activePlayers: players.length,
        newPlayers: players.filter((p) => p.joined >= a && p.joined < b).length,
        withAccounts: players.filter((p) => p.username).length,
        dailies: sum("dailies"),
        unlimitedRuns: sum("unlimitedRuns"),
        quickRuns: sum("quickRuns"),
        partyGames: sum("partyGames"),
        abyss: sum("abyss"),
      },
      players: players.slice(0, 500),
    });
  });

  /** One player's recent activity, newest first. */
  routes.get("/api/admin/player/:id", async (c) => {
    const id = c.req.param("id");
    const db = c.env.DB;
    const [profile, sessions, practice, party, abyss] = await db.batch([
      db.prepare("SELECT id, nickname, friend_code, created_at FROM players WHERE id = ?").bind(id),
      db.prepare(
        `SELECT s.mode, s.date, s.created_at, s.finished, COALESCE(SUM(p.points), 0) AS points, COUNT(p.idx) AS answered
         FROM sessions s LEFT JOIN plays p ON p.session_id = s.id WHERE s.player_id = ? GROUP BY s.id ORDER BY s.created_at DESC LIMIT 60`,
      ).bind(id),
      db.prepare("SELECT mode, score, finished, started_at FROM practice_runs WHERE player_id = ? ORDER BY started_at DESC LIMIT 40").bind(id),
      db.prepare("SELECT kind, variant, rank, player_count, finished_at FROM party_results WHERE player_id = ? ORDER BY finished_at DESC LIMIT 40").bind(id),
      db.prepare("SELECT week, best_tier, best_answer, started_at FROM abyss_attempts WHERE player_id = ? ORDER BY started_at DESC LIMIT 10").bind(id),
    ]);
    const p = profile.results[0] as { id: string; nickname: string | null; friend_code: string | null; created_at: number } | undefined;
    if (!p) throw new HttpError(404, "No such player");
    const account = await db.prepare("SELECT username FROM accounts WHERE player_id = ?").bind(id).first<{ username: string }>().catch(() => null);
    type Item = { at: number; what: string };
    const items: Item[] = [];
    for (const s of sessions.results as { mode: string; date: string | null; created_at: number; finished: number; points: number; answered: number }[]) {
      const label = s.mode === "daily" ? `Daily ${s.date}` : s.mode === "archive" ? `Archive Daily ${s.date}` : "Unlimited dive";
      items.push({ at: s.created_at, what: `${label}: ${s.points * 10} m${s.finished ? "" : " (not finished)"}` });
    }
    for (const r of practice.results as { mode: string; score: number | null; finished: number; started_at: number }[]) {
      items.push({ at: r.started_at, what: `Quick mode ${r.mode}: ${r.finished ? `score ${r.score ?? 0}` : "not finished"}` });
    }
    for (const r of party.results as { kind: string; variant: string | null; rank: number; player_count: number; finished_at: number }[]) {
      items.push({ at: r.finished_at, what: `Party ${r.kind}${r.variant && r.variant !== "classic" ? ` (${r.variant})` : ""}: placed ${r.rank} of ${r.player_count}` });
    }
    for (const r of abyss.results as { week: string; best_tier: number | null; best_answer: string | null; started_at: number }[]) {
      items.push({ at: r.started_at, what: `Weekly Abyss ${r.week}: ${r.best_answer ? `best "${r.best_answer}"` : "no answer"}` });
    }
    items.sort((x, y) => y.at - x.at);
    await ensureRewards(c.env);
    const w = await db.prepare("SELECT pearls, owned FROM wallet WHERE player_id = ?").bind(id).first<{ pearls: number; owned: string }>();
    return c.json({
      id: p.id,
      nickname: p.nickname,
      username: account?.username ?? null,
      friendCode: p.friend_code,
      joined: p.created_at,
      activity: items.slice(0, 80),
      pearls: w?.pearls ?? 0,
      owned: w ? (JSON.parse(w.owned) as string[]) : [],
      ban: await banOf(c.env, id),
    });
  });

  /** Find a player by account username, friend code or exact name (for gifts). */
  routes.get("/api/admin/find-player", async (c) => {
    const q = String(c.req.query("q") ?? "").trim();
    if (!q) throw new HttpError(400, "Type a username, friend code or name");
    const db = c.env.DB;
    const acct = await db.prepare("SELECT player_id FROM accounts WHERE username_key = ?").bind(q.toLowerCase()).first<{ player_id: string }>().catch(() => null);
    const { results } = await db
      .prepare(
        `SELECT id, nickname, friend_code FROM players
         WHERE id = ?1 OR UPPER(friend_code) = UPPER(?2) OR LOWER(nickname) = LOWER(?2) ORDER BY created_at DESC LIMIT 10`,
      )
      .bind(acct?.player_id ?? "", q)
      .all<{ id: string; nickname: string | null; friend_code: string | null }>();
    return c.json({ players: results });
  });

  /** Give a player shop items (any, including earn-only ones) and/or pearls. */
  routes.post("/api/admin/gift", async (c) => {
    const body = await c.req.json<{ playerId?: string; items?: string[]; pearls?: number; note?: string }>().catch(() => ({}) as Record<string, never>);
    const playerId = String(body.playerId ?? "");
    const db = c.env.DB;
    const exists = await db.prepare("SELECT id FROM players WHERE id = ?").bind(playerId).first();
    if (!exists) throw new HttpError(404, "No such player");
    const items = [...new Set((body.items ?? []).map(String))];
    const bad = items.filter((i) => !ITEM_BY_ID.has(i));
    if (bad.length) throw new HttpError(400, `Unknown item: ${bad.join(", ")}`);
    const pearls = Math.max(0, Math.min(100_000, Math.round(Number(body.pearls) || 0)));
    if (!items.length && !pearls) throw new HttpError(400, "Pick at least one item or some pearls");
    const note = String(body.note ?? "").trim().slice(0, 50);
    await ensureRewards(c.env);
    const now = Date.now();
    await db.batch(earnStatements(c.env, playerId, [{ key: `gift:${crypto.randomUUID()}`, pearls, label: note ? `Gift: ${note}` : "Gift from Fathom", items }], now));
    const w = await db.prepare("SELECT pearls, owned FROM wallet WHERE player_id = ?").bind(playerId).first<{ pearls: number; owned: string }>();
    return c.json({ ok: true, pearls: w?.pearls ?? 0, owned: w ? (JSON.parse(w.owned) as string[]) : [] });
  });

  /** Recent Dailies at a glance: divers, average depth, and the seven prompts. */
  routes.get("/api/admin/dailies", async (c) => {
    const days = Math.max(1, Math.min(60, Number(c.req.query("days") ?? 14)));
    await ensureSchema(c.env);
    const end = today();
    const start = addDays(end, -(days - 1));
    const db = c.env.DB;
    const [hist, sets] = await db.batch([
      db.prepare("SELECT date, points, n FROM daily_hist WHERE date BETWEEN ? AND ?").bind(start, end),
      db.prepare("SELECT date, question_ids FROM daily_sets WHERE date BETWEEN ? AND ? ORDER BY date DESC").bind(start, end),
    ]);
    const agg = new Map<string, { n: number; total: number }>();
    for (const r of hist.results as { date: string; points: number; n: number }[]) {
      const a = agg.get(r.date) ?? { n: 0, total: 0 };
      a.n += r.n;
      a.total += r.points * r.n;
      agg.set(r.date, a);
    }
    const setRows = sets.results as { date: string; question_ids: string }[];
    const allIds = [...new Set(setRows.flatMap((r) => JSON.parse(r.question_ids) as string[]))];
    const qs = await getQuestions(c.env, allIds);
    return c.json(
      setRows.map((r) => {
        const a = agg.get(r.date);
        return {
          date: r.date,
          divers: a?.n ?? 0,
          avgDepth: a?.n ? Math.round((a.total / a.n) * 10) : null,
          prompts: (JSON.parse(r.question_ids) as string[]).map((id) => ({ id, prompt: qs.get(id)?.prompt ?? id, category: qs.get(id)?.category ?? "" })),
        };
      }),
    );
  });

  /** One Daily in detail: the score spread and, for each question, how people did and what they answered. */
  routes.get("/api/admin/daily/:date", async (c) => {
    const date = c.req.param("date");
    if (!isDate(date)) throw new HttpError(400, "Bad date");
    await ensureSchema(c.env);
    const db = c.env.DB;
    const ids = date <= today() ? await getDailySet(c.env, date) : [];
    if (!ids.length) throw new HttpError(404, "No Daily was played on that date");
    const [hist, plays] = await db.batch([
      db.prepare("SELECT points, n FROM daily_hist WHERE date = ? ORDER BY points").bind(date),
      db.prepare(
        `SELECT p.idx, p.question_id, p.canonical, p.tier, p.points, p.ms_used FROM plays p JOIN sessions s ON s.id = p.session_id
         WHERE s.mode = 'daily' AND s.date = ?`,
      ).bind(date),
    ]);
    const qs = await getQuestions(c.env, ids);
    const histRows = hist.results as { points: number; n: number }[];
    const divers = histRows.reduce((n, r) => n + r.n, 0);
    const per = ids.map((id) => ({
      id,
      prompt: qs.get(id)?.prompt ?? id,
      category: qs.get(id)?.category ?? "",
      plays: 0,
      correct: 0,
      totalPoints: 0,
      totalMs: 0,
      tiers: {} as Record<string, number>,
      answers: new Map<string, number>(),
    }));
    for (const p of plays.results as { idx: number; question_id: string; canonical: string | null; tier: number | null; points: number; ms_used: number }[]) {
      const q = per.find((x) => x.id === p.question_id);
      if (!q) continue;
      q.plays++;
      q.totalPoints += p.points;
      q.totalMs += p.ms_used;
      const tierKey = p.tier ? String(p.tier) : "miss";
      q.tiers[tierKey] = (q.tiers[tierKey] ?? 0) + 1;
      if (p.canonical) {
        q.correct++;
        q.answers.set(p.canonical, (q.answers.get(p.canonical) ?? 0) + 1);
      }
    }
    // Most common wrong guesses per question (from the review queue, all modes).
    const wrong = await db
      .prepare("SELECT question_id, normalized, count FROM rejected_guesses WHERE question_id IN (SELECT value FROM json_each(?)) ORDER BY count DESC LIMIT 140")
      .bind(JSON.stringify(ids))
      .all<{ question_id: string; normalized: string; count: number }>();
    return c.json({
      date,
      divers,
      avgDepth: divers ? Math.round((histRows.reduce((n, r) => n + r.points * r.n, 0) / divers) * 10) : null,
      histogram: histRows.map((r) => ({ depth: r.points * 10, n: r.n })),
      questions: per.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        category: q.category,
        plays: q.plays,
        successRate: q.plays ? Math.round((q.correct / q.plays) * 100) : null,
        avgPoints: q.plays ? Math.round(q.totalPoints / q.plays) : null,
        avgSeconds: q.plays ? Math.round(q.totalMs / q.plays / 100) / 10 : null,
        tiers: q.tiers,
        topAnswers: [...q.answers].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([answer, n]) => ({ answer, n })),
        wrongGuesses: wrong.results.filter((w) => w.question_id === q.id).slice(0, 10).map((w) => ({ guess: w.normalized, n: w.count })),
      })),
    });
  });

  /**
   * Questions players struggle with most: recent Dailies and Unlimited questions
   * with the lowest success rates (enough plays to be meaningful). Used by the
   * portal and the weekly task to decide what to delete.
   */
  routes.get("/api/admin/struggling", async (c) => {
    const days = Math.max(1, Math.min(90, Number(c.req.query("days") ?? 21)));
    const minPlays = Math.max(1, Number(c.req.query("min") ?? 15));
    const since = addDays(today(), -days);
    const db = c.env.DB;
    const [dailies, all] = await db.batch([
      db.prepare(
        `SELECT q.id, q.prompt, q.category, q.status, q.daily_date, COUNT(*) AS plays, SUM(p.answer_id IS NOT NULL) AS correct, AVG(p.points) AS avg_points
         FROM plays p JOIN sessions s ON s.id = p.session_id JOIN questions q ON q.id = p.question_id
         WHERE s.mode = 'daily' AND s.date >= ? GROUP BY q.id HAVING COUNT(*) >= ? ORDER BY CAST(SUM(p.answer_id IS NOT NULL) AS REAL) / COUNT(*) ASC LIMIT 25`,
      ).bind(since, minPlays),
      db.prepare(
        `SELECT q.id, q.prompt, q.category, q.status, q.daily_date, COUNT(*) AS plays, SUM(p.answer_id IS NOT NULL) AS correct, AVG(p.points) AS avg_points
         FROM plays p JOIN questions q ON q.id = p.question_id
         WHERE q.status IN ('unlimited', 'scheduled') GROUP BY q.id HAVING COUNT(*) >= ? ORDER BY CAST(SUM(p.answer_id IS NOT NULL) AS REAL) / COUNT(*) ASC LIMIT 40`,
      ).bind(minPlays),
    ]);
    type R = { id: string; prompt: string; category: string; status: string; daily_date: string | null; plays: number; correct: number; avg_points: number };
    const shape = (r: R) => ({
      id: r.id,
      prompt: r.prompt,
      category: r.category,
      status: r.status,
      dailyDate: r.daily_date,
      plays: r.plays,
      successRate: Math.round((r.correct / r.plays) * 100),
      avgPoints: Math.round(r.avg_points),
    });
    return c.json({ days, minPlays, recentDailies: (dailies.results as R[]).map(shape), allQuestions: (all.results as R[]).map(shape) });
  });
}
