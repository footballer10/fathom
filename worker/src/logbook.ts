import { Hono } from "hono";
import type { Context } from "hono";
import { HttpError } from "./env";
import type { Env } from "./env";
import { dailyNumber, getQuestions } from "./questions";
import { ensureSchema } from "./schema";
import { ensureRewards } from "./rewards";

/**
 * The logbook: one player's diving history. Every Daily they've played (with
 * each answer on tap), their rarest finds, lifetime numbers and tier counts.
 * Only ever reads that one player's rows.
 */

type AppEnv = { Bindings: Env };
export const logbookRoutes = new Hono<AppEnv>();

function pid(c: Context<AppEnv>): string {
  const id = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  return id;
}

logbookRoutes.get("/api/logbook", async (c) => {
  const playerId = pid(c);
  await ensureSchema(c.env);
  await ensureRewards(c.env);
  const [dailies, finds, tiers, stats, wallet] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT date, points, tiers FROM daily_results WHERE player_id = ? ORDER BY date DESC").bind(playerId),
    c.env.DB.prepare(
      `SELECT p.canonical, p.tier, p.question_id, s.mode, s.date, p.created_at AS at
       FROM sessions s INDEXED BY idx_sessions_player JOIN plays p ON p.session_id = s.id
       WHERE s.player_id = ? AND p.tier >= 85 AND p.canonical IS NOT NULL
       ORDER BY p.tier DESC, p.created_at DESC LIMIT 30`,
    ).bind(playerId),
    c.env.DB.prepare(
      `SELECT COALESCE(p.tier, 0) AS tier, COUNT(*) AS n
       FROM sessions s INDEXED BY idx_sessions_player JOIN plays p ON p.session_id = s.id
       WHERE s.player_id = ? AND s.mode IN ('daily', 'unlimited', 'archive') GROUP BY COALESCE(p.tier, 0)`,
    ).bind(playerId),
    c.env.DB.prepare("SELECT * FROM lb_stats WHERE player_id = ?").bind(playerId),
    c.env.DB.prepare("SELECT lifetime FROM wallet WHERE player_id = ?").bind(playerId),
  ]);
  const findRows = finds.results as { canonical: string; tier: number; question_id: string; mode: string; date: string | null; at: number }[];
  const prompts = await getQuestions(c.env, [...new Set(findRows.map((f) => f.question_id))]);
  const s = (stats.results[0] ?? {}) as Record<string, number>;
  const n = (k: string) => s[k] ?? 0;
  return c.json({
    totals: {
      dailies: n("d_dives"),
      unlimited: n("u_dives"),
      answers: n("d_n") + n("u_n"),
      krillions: n("d_k") + n("u_k") + n("abyss_k"),
      deepCuts: n("d_rare") + n("u_rare"),
      bestDaily: n("d_best") * 10,
      bestUnlimited: n("u_best") * 10,
      bestStreak: n("streak_best"),
      partyGames: n("p_games"),
      partyWins: n("p_wins"),
      bestSprint: n("best_sprint"),
      bestLadder: n("best_ladder"),
      bestRoulette: n("best_roulette"),
      bestFive: n("best_five"),
      pearls: (wallet.results[0] as { lifetime?: number } | undefined)?.lifetime ?? 0,
    },
    tiers: Object.fromEntries((tiers.results as { tier: number; n: number }[]).map((r) => [String(r.tier || "miss"), r.n])),
    dailies: await Promise.all(
      (dailies.results as { date: string; points: number; tiers: string }[]).map(async (d) => ({
        date: d.date,
        number: await dailyNumber(c.env, d.date),
        depth: d.points * 10,
        tiers: JSON.parse(d.tiers) as (number | null)[],
      })),
    ),
    finds: findRows.map((f) => ({
      canonical: f.canonical,
      tier: f.tier,
      prompt: prompts.get(f.question_id)?.prompt ?? "",
      mode: f.mode,
      date: f.date,
      at: f.at,
    })),
  });
});

/** One day's Daily: every prompt with your answer. */
logbookRoutes.get("/api/logbook/day/:date", async (c) => {
  const playerId = pid(c);
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Bad date");
  const session = await c.env.DB.prepare("SELECT id FROM sessions WHERE player_id = ? AND date = ? AND mode = 'daily'").bind(playerId, date).first<{ id: string }>();
  if (!session) throw new HttpError(404, "You didn't dive that Daily");
  const { results } = await c.env.DB.prepare("SELECT idx, question_id, canonical, tier, points, ms_used FROM plays WHERE session_id = ? ORDER BY idx")
    .bind(session.id)
    .all<{ idx: number; question_id: string; canonical: string | null; tier: number | null; points: number; ms_used: number }>();
  const qs = await getQuestions(c.env, results.map((r) => r.question_id));
  return c.json({
    date,
    number: await dailyNumber(c.env, date),
    plays: results.map((r) => ({
      prompt: qs.get(r.question_id)?.prompt ?? "",
      canonical: r.canonical,
      tier: r.tier,
      points: r.points,
      seconds: Math.round(r.ms_used / 100) / 10,
    })),
  });
});
