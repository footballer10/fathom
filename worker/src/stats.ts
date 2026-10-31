import { TIERS, addDays, pointsToDepth } from "@fathom/shared";
import type { Env } from "./env";
import { today } from "./questions";

export interface PlayerStats {
  played: number;
  currentStreak: number;
  bestStreak: number;
  averageDepth: number;
  bestDepth: number;
  /** Count of answers per tier (key = tier points, "miss" = timed out). */
  histogram: Record<string, number>;
  recent: { date: string; points: number }[];
  /** Unlimited: dives finished, prompts answered correctly, deepest dive, prompts seen so far. */
  unlimited: { dives: number; answered: number; bestDepth: number; seen: number };
}

/** Daily streaks and stats for one player, computed from daily_results. */
export async function playerStats(env: Env, playerId: string, now: number): Promise<PlayerStats> {
  const { results } = await env.DB.prepare("SELECT date, points, tiers FROM daily_results WHERE player_id = ? ORDER BY date")
    .bind(playerId)
    .all<{ date: string; points: number; tiers: string }>();

  const histogram: Record<string, number> = { miss: 0 };
  for (const t of TIERS) histogram[t.points] = 0;
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const r of results) {
    run = prev && addDays(prev, 1) === r.date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = r.date;
    for (const t of JSON.parse(r.tiers) as (number | null)[]) histogram[t === null ? "miss" : String(t)] += 1;
  }
  // The current streak survives until the end of today (you might not have played yet).
  const date = today(now);
  const current = prev === date || prev === addDays(date, -1) ? run : 0;
  const total = results.reduce((n, r) => n + r.points, 0);

  const [dives, seen] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS dives, COALESCE(SUM(answered), 0) AS answered, COALESCE(MAX(points), 0) AS best FROM (
         SELECT s.id, SUM(pl.answer_id IS NOT NULL) AS answered, SUM(pl.points) AS points
         FROM sessions s JOIN plays pl ON pl.session_id = s.id
         WHERE s.player_id = ? AND s.mode = 'unlimited' AND s.finished = 1 GROUP BY s.id)`,
    ).bind(playerId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM seen WHERE player_id = ?").bind(playerId),
  ]);
  const u = (dives.results[0] ?? {}) as { dives?: number; answered?: number; best?: number };

  return {
    played: results.length,
    currentStreak: current,
    bestStreak: best,
    averageDepth: results.length ? Math.round(pointsToDepth(total / results.length)) : 0,
    bestDepth: results.length ? pointsToDepth(Math.max(...results.map((r) => r.points))) : 0,
    histogram,
    recent: results.slice(-14).map((r) => ({ date: r.date, points: r.points })),
    unlimited: {
      dives: u.dives ?? 0,
      answered: u.answered ?? 0,
      bestDepth: pointsToDepth(u.best ?? 0),
      seen: (seen.results[0] as { n?: number } | undefined)?.n ?? 0,
    },
  };
}
