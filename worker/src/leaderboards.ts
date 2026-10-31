import { Hono } from "hono";
import type { Context } from "hono";
import { ensureAbyss, ensureRuns, weekOf } from "./practice";
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
  // The party mode (Co-op, Shark Tank…) was added later; add the column once if it's missing.
  await env.DB.prepare("ALTER TABLE party_results ADD COLUMN variant TEXT NOT NULL DEFAULT 'classic'").run().catch(() => {});
  partyTableReady = true;
}

/** Called by the Room when a party game with at least two players ends. */
export async function recordPartyResults(
  env: Env,
  kind: "dive" | "battle",
  room: string,
  results: { playerId: string; rank: number; score: number }[],
  now: number,
  variant = "classic",
) {
  if (results.length < 2) return;
  await ensurePartyTable(env);
  await env.DB.batch(
    results.map((r) =>
      env.DB.prepare(
        "INSERT INTO party_results (kind, variant, room, player_id, rank, player_count, score, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(kind, variant, room, r.playerId, r.rank, results.length, r.score, now),
    ),
  );
}

export interface Board {
  id: string;
  title: string;
  description: string;
  /** Which section of the page it sits in. */
  group: string;
  /** How to show the value. "tier" is a tier's points (shown as its name). */
  unit: "count" | "meters" | "percent" | "days" | "rungs" | "hits" | "tier";
  rows: { rank: number; nickname: string; value: number; playerId: string; code: string | null }[];
}

/** Each board: SQL returning (player_id, value) for named players, highest first. */
const NAMED = "p.nickname IS NOT NULL AND TRIM(p.nickname) != ''";
const SOLO_PLAYS = `FROM plays pl JOIN sessions s ON s.id = pl.session_id JOIN players p ON p.id = s.player_id
                    WHERE ${NAMED} AND s.mode IN ('daily', 'unlimited')`;

type BoardDef = { id: string; title: string; description: string; unit: Board["unit"]; group?: string; sql: string | ((now: number) => string) };

const SOLO_GROUP = "Daily & Unlimited";
const QUICK_GROUP = "Quick modes";
const ABYSS_GROUP = "Weekly Abyss";
const PARTY_GROUP = "Party";

/** Best finished run per player in one quick mode. */
const bestRun = (mode: string) => `SELECT r.player_id, MAX(r.score) AS value FROM practice_runs r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.mode = '${mode}' AND r.finished = 1 GROUP BY r.player_id`;
/** Party wins in one mode (several winners can share 1st in team and survival modes). */
const partyWins = (kind: string, variant: string) => `SELECT r.player_id, COUNT(*) AS value FROM party_results r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.kind = '${kind}' AND COALESCE(r.variant, 'classic') = '${variant}' AND r.rank = 1 GROUP BY r.player_id`;

const BOARDS: BoardDef[] = [
  {
    id: "unlimited-answered",
    title: "Unlimited explorers",
    description: "Unlimited prompts answered correctly",
    unit: "count",
    sql: `SELECT s.player_id, SUM(pl.answer_id IS NOT NULL) AS value ${SOLO_PLAYS} AND s.mode = 'unlimited' GROUP BY s.player_id HAVING value > 0`,
  },
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
    group: PARTY_GROUP,
    title: "Party Dive wins",
    description: "Group Dive games won",
    unit: "count",
    sql: `SELECT r.player_id, COUNT(*) AS value FROM party_results r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.kind = 'dive' AND COALESCE(r.variant, 'classic') = 'classic' AND r.rank = 1 GROUP BY r.player_id`,
  },
  { id: "coop-wins", group: PARTY_GROUP, title: "🤝 Co-op successes", description: "Co-op Dives where the team reached the target", unit: "count", sql: partyWins("dive", "coop") },
  { id: "shark-wins", group: PARTY_GROUP, title: "🦈 Shark Tank survivors", description: "Shark Tank games survived to the end", unit: "count", sql: partyWins("dive", "shark") },
  { id: "school-wins", group: PARTY_GROUP, title: "🐟 School of Fish wins", description: "School of Fish games won", unit: "count", sql: partyWins("dive", "school") },
  {
    id: "battle-wins",
    group: PARTY_GROUP,
    title: "Battle wins",
    description: "Last diver standing in Battle",
    unit: "count",
    sql: `SELECT r.player_id, COUNT(*) AS value FROM party_results r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.kind = 'battle' AND COALESCE(r.variant, 'classic') = 'classic' AND r.rank = 1 GROUP BY r.player_id`,
  },
  { id: "hotpotato-wins", group: PARTY_GROUP, title: "🥔 Hot Potato wins", description: "Hot Potato games won", unit: "count", sql: partyWins("battle", "hotpotato") },
  { id: "relay-wins", group: PARTY_GROUP, title: "🔤 Relay wins", description: "Relay games won with your team", unit: "count", sql: partyWins("battle", "relay") },
  {
    id: "party-win-rate",
    group: PARTY_GROUP,
    title: "Party win rate",
    description: `Share of party games won, every mode (${MIN_PARTY_GAMES_FOR_RATE}+ games)`,
    unit: "percent",
    sql: `SELECT r.player_id, ROUND(100.0 * SUM(r.rank = 1) / COUNT(*), 1) AS value FROM party_results r
          JOIN players p ON p.id = r.player_id WHERE ${NAMED}
          GROUP BY r.player_id HAVING COUNT(*) >= ${MIN_PARTY_GAMES_FOR_RATE}`,
  },

  // Quick modes: best scored run (the server works the score out itself).
  { id: "sprint", group: QUICK_GROUP, title: "⚡ Sprint", description: "Most depth in 60 seconds", unit: "meters", sql: bestRun("sprint").replace("MAX(r.score)", "MAX(r.score) * 10") },
  { id: "ladder", group: QUICK_GROUP, title: "🪜 Ladder", description: "Highest climb without going more common", unit: "rungs", sql: bestRun("ladder") },
  { id: "roulette", group: QUICK_GROUP, title: "🎯 Rarity Roulette", description: "Most exact tiers hit out of 7", unit: "hits", sql: bestRun("roulette") },
  { id: "five", group: QUICK_GROUP, title: "🖐️ Five Answers", description: "Deepest five answers to one prompt", unit: "meters", sql: bestRun("five").replace("MAX(r.score)", "MAX(r.score) * 10") },

  // Weekly Abyss: this week's rarest answer, and Abyss dives taken all time.
  {
    id: "abyss-week",
    group: ABYSS_GROUP,
    title: "🕳️ This week's Abyss",
    description: "Rarest answer in this week's dive",
    unit: "tier",
    sql: (now) => `SELECT a.player_id, MAX(a.best_tier) AS value FROM abyss_attempts a JOIN players p ON p.id = a.player_id
          WHERE ${NAMED} AND a.week = '${weekOf(now).week}' AND a.best_tier IS NOT NULL GROUP BY a.player_id`,
  },
  {
    id: "abyss-krillions",
    group: ABYSS_GROUP,
    title: "🐋 Abyss krillions",
    description: "Weeks where your Abyss answer was a One in a Krillion",
    unit: "count",
    sql: `SELECT a.player_id, COUNT(*) AS value FROM abyss_attempts a JOIN players p ON p.id = a.player_id
          WHERE ${NAMED} AND a.best_tier = 100 GROUP BY a.player_id`,
  },
];

let cache: { at: number; boards: Board[] } | null = null;

async function computeBoards(env: Env): Promise<Board[]> {
  await Promise.all([ensurePartyTable(env), ensureRuns(env), ensureAbyss(env)]);
  const now = Date.now();
  const names = new Map<string, string>();
  const results = await env.DB.batch(
    BOARDS.map((b) =>
      env.DB.prepare(
        `SELECT t.player_id, t.value, p.nickname, p.friend_code FROM (${typeof b.sql === "function" ? b.sql(now) : b.sql}) t JOIN players p ON p.id = t.player_id
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
      group: b.group ?? SOLO_GROUP,
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
