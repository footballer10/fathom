import { Hono } from "hono";
import type { Context } from "hono";
import { friendStatus } from "./social";
import { HttpError } from "./env";
import type { Env } from "./env";

/**
 * Global leaderboards. Only players who have set a name appear on them.
 * Solo stats come from finished Daily and Unlimited dives (plays/sessions);
 * party wins come from party_results, written by the Room when a game ends.
 */

type AppEnv = { Bindings: Env };
export const leaderboardRoutes = new Hono<AppEnv>();

const TOP = 10;
/** Rate boards only count players with enough answers to be meaningful. */
const MIN_ANSWERS_FOR_RATES = 50;
const MIN_PARTY_GAMES_FOR_RATE = 5;
const CACHE_SECONDS = 120;

// party_results arrived after launch. The migration creates it, but automatic
// deploys don't run migrations, so make sure it exists before first use.
let partyTableReady = false;
async function ensurePartyTable(env: Env) {
  if (partyTableReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS party_results (
         id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, room TEXT NOT NULL, player_id TEXT NOT NULL,
         rank INTEGER NOT NULL, player_count INTEGER NOT NULL, score INTEGER NOT NULL, finished_at INTEGER NOT NULL)`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_party_results_player ON party_results(player_id)"),
  ]);
  partyTableReady = true;
}

/** Called by the Room when a party game with at least two players ends. */
export async function recordPartyResults(
  env: Env,
  kind: "dive" | "battle",
  room: string,
  results: { playerId: string; rank: number; score: number }[],
  now: number,
) {
  if (results.length < 2) return;
  await ensurePartyTable(env);
  await env.DB.batch(
    results.map((r) =>
      env.DB.prepare(
        "INSERT INTO party_results (kind, room, player_id, rank, player_count, score, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(kind, room, r.playerId, r.rank, results.length, r.score, now),
    ),
  );
}

export interface Board {
  id: string;
  title: string;
  description: string;
  /** How to show the value: a count, metres, or a percentage. */
  unit: "count" | "meters" | "percent" | "days";
  rows: { rank: number; nickname: string; value: number; playerId: string; code: string | null }[];
}

/** Each board: SQL returning (player_id, value) for named players, highest first. */
const NAMED = "p.nickname IS NOT NULL AND TRIM(p.nickname) != ''";
const SOLO_PLAYS = `FROM plays pl JOIN sessions s ON s.id = pl.session_id JOIN players p ON p.id = s.player_id
                    WHERE ${NAMED} AND s.mode IN ('daily', 'unlimited')`;

const BOARDS: { id: string; title: string; description: string; unit: Board["unit"]; sql: string }[] = [
  {
    id: "dives",
    title: "Most dives",
    description: "Daily and Unlimited dives finished",
    unit: "count",
    sql: `SELECT s.player_id, COUNT(*) AS value FROM sessions s JOIN players p ON p.id = s.player_id
          WHERE ${NAMED} AND s.finished = 1 AND s.mode IN ('daily', 'unlimited') GROUP BY s.player_id`,
  },
  {
    id: "krillions",
    title: "Most One in a Krillions",
    description: "The single rarest answer on a question",
    unit: "count",
    sql: `SELECT s.player_id, SUM(pl.tier = 100) AS value ${SOLO_PLAYS} GROUP BY s.player_id HAVING value > 0`,
  },
  {
    id: "deepcuts",
    title: "Most Deep Cuts",
    description: "Deep Cut answers found",
    unit: "count",
    sql: `SELECT s.player_id, SUM(pl.tier = 85) AS value ${SOLO_PLAYS} GROUP BY s.player_id HAVING value > 0`,
  },
  {
    id: "rare-rate",
    title: "Rarest taste",
    description: `Share of answers that were Deep Cut or One in a Krillion (${MIN_ANSWERS_FOR_RATES}+ questions)`,
    unit: "percent",
    sql: `SELECT s.player_id, ROUND(100.0 * SUM(pl.tier >= 85) / COUNT(*), 1) AS value ${SOLO_PLAYS}
          GROUP BY s.player_id HAVING COUNT(*) >= ${MIN_ANSWERS_FOR_RATES}`,
  },
  {
    id: "krillion-rate",
    title: "Krillion hunters",
    description: `Share of questions answered with the One in a Krillion (${MIN_ANSWERS_FOR_RATES}+ questions)`,
    unit: "percent",
    sql: `SELECT s.player_id, ROUND(100.0 * SUM(pl.tier = 100) / COUNT(*), 1) AS value ${SOLO_PLAYS}
          GROUP BY s.player_id HAVING COUNT(*) >= ${MIN_ANSWERS_FOR_RATES} AND SUM(pl.tier = 100) > 0`,
  },
  {
    id: "accuracy",
    title: "Sharpest",
    description: `Share of questions answered correctly (${MIN_ANSWERS_FOR_RATES}+ questions)`,
    unit: "percent",
    sql: `SELECT s.player_id, ROUND(100.0 * SUM(pl.answer_id IS NOT NULL) / COUNT(*), 1) AS value ${SOLO_PLAYS}
          GROUP BY s.player_id HAVING COUNT(*) >= ${MIN_ANSWERS_FOR_RATES}`,
  },
  {
    id: "deepest-dive",
    title: "Deepest single dive",
    description: "Best depth in one Daily or Unlimited dive",
    unit: "meters",
    sql: `SELECT player_id, MAX(total) * 10 AS value FROM (
            SELECT s.player_id, s.id, SUM(pl.points) AS total ${SOLO_PLAYS} GROUP BY s.id
          ) GROUP BY player_id`,
  },
  {
    id: "total-depth",
    title: "Deepest of all time",
    description: "Total depth across every dive",
    unit: "meters",
    sql: `SELECT s.player_id, SUM(pl.points) * 10 AS value ${SOLO_PLAYS} GROUP BY s.player_id HAVING value > 0`,
  },
  {
    id: "streak",
    title: "Longest Daily streak",
    description: "Most Dailies played in a row",
    unit: "days",
    sql: `SELECT player_id, MAX(len) AS value FROM (
            SELECT player_id, COUNT(*) AS len FROM (
              SELECT d.player_id, julianday(d.date) - ROW_NUMBER() OVER (PARTITION BY d.player_id ORDER BY d.date) AS grp
              FROM daily_results d JOIN players p ON p.id = d.player_id WHERE ${NAMED}
            ) GROUP BY player_id, grp
          ) GROUP BY player_id`,
  },
  {
    id: "dive-wins",
    title: "Party Dive wins",
    description: "Group Dive games won",
    unit: "count",
    sql: `SELECT r.player_id, COUNT(*) AS value FROM party_results r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.kind = 'dive' AND r.rank = 1 GROUP BY r.player_id`,
  },
  {
    id: "battle-wins",
    title: "Battle wins",
    description: "Last diver standing in Battle",
    unit: "count",
    sql: `SELECT r.player_id, COUNT(*) AS value FROM party_results r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.kind = 'battle' AND r.rank = 1 GROUP BY r.player_id`,
  },
  {
    id: "party-win-rate",
    title: "Party win rate",
    description: `Share of party games won, Dive and Battle (${MIN_PARTY_GAMES_FOR_RATE}+ games)`,
    unit: "percent",
    sql: `SELECT r.player_id, ROUND(100.0 * SUM(r.rank = 1) / COUNT(*), 1) AS value FROM party_results r
          JOIN players p ON p.id = r.player_id WHERE ${NAMED}
          GROUP BY r.player_id HAVING COUNT(*) >= ${MIN_PARTY_GAMES_FOR_RATE}`,
  },
];

let cache: { at: number; boards: Board[] } | null = null;

async function computeBoards(env: Env): Promise<Board[]> {
  await ensurePartyTable(env);
  const names = new Map<string, string>();
  const results = await env.DB.batch(
    BOARDS.map((b) =>
      env.DB.prepare(
        `SELECT t.player_id, t.value, p.nickname, p.friend_code FROM (${b.sql}) t JOIN players p ON p.id = t.player_id
         WHERE t.value > 0 ORDER BY t.value DESC, p.nickname LIMIT ${TOP}`,
      ),
    ),
  );
  return BOARDS.map((b, i) => {
    const rows = (results[i].results as { player_id: string; value: number; nickname: string; friend_code: string | null }[]).map((r) => {
      names.set(r.player_id, r.nickname);
      return { playerId: r.player_id, nickname: r.nickname, value: r.value, code: r.friend_code };
    });
    // Equal values share a rank.
    let rank = 0;
    let prev: number | null = null;
    return {
      id: b.id,
      title: b.title,
      description: b.description,
      unit: b.unit,
      rows: rows.map((r, j) => {
        if (r.value !== prev) rank = j + 1;
        prev = r.value;
        return { rank, ...r };
      }),
    };
  });
}

leaderboardRoutes.get("/api/leaderboards", async (c: Context<AppEnv>) => {
  const id = c.req.header("X-Player-Id") ?? "";
  if (id && !/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  const now = Date.now();
  // Local dev skips the cache so tests see their own results straight away.
  const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(c.req.url).hostname);
  if (local || !cache || now - cache.at > CACHE_SECONDS * 1000) cache = { at: now, boards: await computeBoards(c.env) };
  // Player ids never leave the server; the client gets each row's public friend
  // code (for friend requests) and whether it's you, a friend, or already asked.
  const rel = id ? await friendStatus(c.env, id) : { friends: new Set<string>(), sent: new Set<string>() };
  return c.json({
    updatedAt: cache.at,
    minAnswersForRates: MIN_ANSWERS_FOR_RATES,
    boards: cache.boards.map((b) => ({
      ...b,
      rows: b.rows.map(({ playerId, ...r }) => ({
        ...r,
        you: playerId === id,
        friend: rel.friends.has(playerId) ? ("friends" as const) : rel.sent.has(playerId) ? ("sent" as const) : null,
      })),
    })),
  });
});
