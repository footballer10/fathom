import type { Hono } from "hono";
import { HttpError } from "./env";
import type { Env } from "./env";
import { ensureSchema } from "./schema";
import { ensureBans } from "./bans";

/**
 * Possible cheating, for the admin portal's Flagged tab. Nothing here acts on
 * its own: it only lists players whose recent Daily and Unlimited dives look
 * like answers were looked up (most likely pasted from an AI), with the reasons,
 * for a person to review.
 *
 * Signals, each compared with the average player over the same 30 days:
 *  - rare:     most answers are Rare or rarer, or a large share are Deep Cut or rarer (one sign)
 *  - neverStuck: answers almost every prompt, with rare answers
 *  - noMistakes: no wrong guesses and no "Did you mean…?" fixes over many answers
 *  - pasted:   typed exactly as the game lists them (capitals, accents, punctuation),
 *              which people typing by hand rarely do
 *  - lookedUp: a steady 6–22 seconds per answer while still landing rare answers,
 *              like copying the prompt into an AI and waiting for the reply
 * Two or more signals = flagged. "Not cheating" hides a player until new dives
 * (after that moment) give fresh evidence.
 */

type AppEnv = { Bindings: Env };

const WINDOW_DAYS = 30;
const MIN_ANSWERS = 14;
const MIN_TYPED = 10;

interface Agg {
  player_id: string;
  nickname: string | null;
  dives: number;
  n: number;
  ans: number;
  rare: number;
  deep: number;
  typos: number;
  avgms: number | null;
  typed: number;
  exact: number;
  wrongs: number;
  tracked_ans: number;
  tracked_typos: number;
  last_at: number;
}

export interface Flag {
  playerId: string;
  nickname: string | null;
  dives: number;
  answers: number;
  score: number;
  reasons: string[];
  lastAt: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

async function ensureReviews(env: Env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS cheat_reviews (player_id TEXT PRIMARY KEY, dismissed_at INTEGER NOT NULL)").run();
}

export async function flaggedPlayers(env: Env, now: number): Promise<{ flags: Flag[]; site: Record<string, string>; trackingSince: number | null }> {
  await ensureSchema(env);
  await ensureBans(env);
  await ensureReviews(env);
  const since = now - WINDOW_DAYS * 86_400_000;
  const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = 'cheat_tracking_since'").first<{ value: string }>();
  const tracking = meta ? Number(meta.value) : now;
  // One row per recently active player. Uppercase/accents/punctuation in an exact match = typed like the answer list.
  const { results } = await env.DB.prepare(
    `SELECT s.player_id, pl.nickname, COUNT(DISTINCT s.id) AS dives, COUNT(*) AS n,
            SUM(p.answer_id IS NOT NULL) AS ans, SUM(p.tier >= 60) AS rare, SUM(p.tier >= 85) AS deep,
            SUM(p.corrected) AS typos, AVG(CASE WHEN p.answer_id IS NOT NULL THEN p.ms_used END) AS avgms,
            SUM(p.typed IS NOT NULL) AS typed,
            SUM(p.typed IS NOT NULL AND p.typed = p.canonical AND (p.typed GLOB '*[A-Z]*' OR p.typed GLOB '*[^ -~]*' OR p.typed GLOB '*[''.-]*')) AS exact,
            SUM(CASE WHEN s.created_at >= ?2 AND p.answer_id IS NOT NULL THEN 1 ELSE 0 END) AS tracked_ans,
            SUM(CASE WHEN s.created_at >= ?2 THEN p.corrected ELSE 0 END) AS tracked_typos,
            (SELECT COALESCE(SUM(s2.wrongs), 0) FROM sessions s2 WHERE s2.player_id = s.player_id AND s2.created_at >= MAX(?1, ?2)
               AND s2.mode IN ('daily', 'unlimited') AND s2.created_at > COALESCE(r.dismissed_at, 0)) AS wrongs,
            MAX(s.created_at) AS last_at
     FROM sessions s JOIN plays p ON p.session_id = s.id
     LEFT JOIN players pl ON pl.id = s.player_id
     LEFT JOIN cheat_reviews r ON r.player_id = s.player_id
     WHERE s.created_at >= ?1 AND s.finished = 1 AND s.mode IN ('daily', 'unlimited')
       AND s.created_at > COALESCE(r.dismissed_at, 0)
       AND s.player_id NOT IN (SELECT player_id FROM bans)
     GROUP BY s.player_id`,
  )
    .bind(since, tracking)
    .all<Agg>();

  // The average player, for comparison.
  const tot = results.reduce(
    (t, r) => ({ ans: t.ans + r.ans, n: t.n + r.n, rare: t.rare + r.rare, deep: t.deep + r.deep, typed: t.typed + r.typed, exact: t.exact + r.exact }),
    { ans: 0, n: 0, rare: 0, deep: 0, typed: 0, exact: 0 },
  );
  const siteRare = tot.ans ? tot.rare / tot.ans : 0;
  const siteDeep = tot.ans ? tot.deep / tot.ans : 0;
  const siteAnswered = tot.n ? tot.ans / tot.n : 0;
  const siteExact = tot.typed ? tot.exact / tot.typed : 0;

  const flags: Flag[] = [];
  for (const r of results) {
    if (r.ans < MIN_ANSWERS) continue;
    const rare = r.rare / r.ans;
    const deep = r.deep / r.ans;
    const answered = r.ans / r.n;
    const reasons: string[] = [];
    // One sign for unusually rare answers (Rare-or-rarer and Deep-Cut-or-rarer measure much the same thing).
    const rareSign = rare >= 0.7 && rare >= siteRare + 0.25;
    const deepSign = deep >= 0.4 && deep >= siteDeep + 0.2;
    if (rareSign || deepSign) {
      reasons.push(`Unusually rare answers: ${pct(rare)} Rare or rarer and ${pct(deep)} Deep Cut or rarer (average player: ${pct(siteRare)} and ${pct(siteDeep)})`);
    }
    if (answered >= 0.97 && rare >= 0.5) reasons.push(`Answered ${pct(answered)} of prompts, almost never stuck (average: ${pct(siteAnswered)}), with rare answers`);
    if (r.tracked_ans >= MIN_ANSWERS && r.wrongs === 0 && r.tracked_typos === 0 && rare >= 0.5) {
      reasons.push(`No wrong guesses and no typos in ${r.tracked_ans} answers: spelling always perfect`);
    }
    if (r.typed >= MIN_TYPED && r.exact / r.typed >= 0.6) {
      reasons.push(`${pct(r.exact / r.typed)} typed exactly like the answer list, capitals and accents included (average: ${pct(siteExact)}), as if pasted`);
    }
    const secs = (r.avgms ?? 0) / 1000;
    if (secs >= 6 && secs <= 22 && rare >= 0.6) reasons.push(`A steady ${secs.toFixed(1)}s per answer with mostly rare answers, like looking each one up`);
    if (reasons.length >= 2) {
      flags.push({ playerId: r.player_id, nickname: r.nickname, dives: r.dives, answers: r.ans, score: reasons.length, reasons, lastAt: r.last_at });
    }
  }
  flags.sort((a, b) => b.score - a.score || b.lastAt - a.lastAt);
  return {
    flags,
    site: { rare: pct(siteRare), deep: pct(siteDeep), answered: pct(siteAnswered), exact: tot.typed ? pct(siteExact) : "n/a" },
    trackingSince: meta ? tracking : null,
  };
}

export function registerCheatFlags(routes: Hono<AppEnv>) {
  routes.get("/api/admin/flagged", async (c) => c.json(await flaggedPlayers(c.env, Date.now())));

  /** "Not cheating": hide this player until dives after now give new evidence. */
  routes.post("/api/admin/flagged/dismiss", async (c) => {
    const { playerId } = await c.req.json<{ playerId?: string }>().catch(() => ({ playerId: "" }));
    if (!playerId) throw new HttpError(400, "Missing player");
    await ensureReviews(c.env);
    await c.env.DB.prepare("INSERT OR REPLACE INTO cheat_reviews (player_id, dismissed_at) VALUES (?, ?)").bind(playerId, Date.now()).run();
    return c.json({ ok: true });
  });
}
