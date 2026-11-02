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

type BoardDef = { id: string; title: string; description: string; unit: Board["unit"]; group: string; sql: string | ((now: number) => string) };

// Sections, in page order.
const DAILY_GROUP = "Daily";
const UNLIMITED_GROUP = "Unlimited";
const ABYSS_GROUP = "Weekly Abyss";
const PARTY_GROUP = "Party";
const QUICK_GROUP = "Quick modes";

/** Best finished run per player in one quick mode. */
const bestRun = (mode: string) => `SELECT r.player_id, MAX(r.score) AS value FROM practice_runs r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.mode = '${mode}' AND r.finished = 1 GROUP BY r.player_id`;
/** Party wins in one mode (several winners can share 1st in team and survival modes). */
const partyWins = (kind: string, variant: string) => `SELECT r.player_id, COUNT(*) AS value FROM party_results r JOIN players p ON p.id = r.player_id
          WHERE ${NAMED} AND r.kind = '${kind}' AND COALESCE(r.variant, 'classic') = '${variant}' AND r.rank = 1 GROUP BY r.player_id`;

/**
 * Boards that each run their own (small) query. The Daily and Unlimited boards
 * come from one shared pass over plays instead (see soloBoards), because those
 * tables are big and every query over them costs D1 rows read.
 */
const SQL_BOARDS: BoardDef[] = [
  {
    id: "streak",
    group: DAILY_GROUP,
    title: "🔥 Longest Daily streak",
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
  { id: "dive-wins", group: PARTY_GROUP, title: "🌊 Party Dive wins", description: "Group Dive games won", unit: "count", sql: partyWins("dive", "classic") },
  { id: "battle-wins", group: PARTY_GROUP, title: "🐡 Battle wins", description: "Last diver standing in Battle", unit: "count", sql: partyWins("battle", "classic") },
  { id: "shark-wins", group: PARTY_GROUP, title: "🦈 Shark Tank survivors", description: "Shark Tank games survived to the end", unit: "count", sql: partyWins("dive", "shark") },
  { id: "relay-wins", group: PARTY_GROUP, title: "🔤 Relay wins", description: "Relay games won with your team", unit: "count", sql: partyWins("battle", "relay") },
  { id: "hotpotato-wins", group: PARTY_GROUP, title: "🥔 Hot Potato wins", description: "Hot Potato games won", unit: "count", sql: partyWins("battle", "hotpotato") },
  { id: "school-wins", group: PARTY_GROUP, title: "🐟 School of Fish wins", description: "School of Fish games won", unit: "count", sql: partyWins("dive", "school") },
  { id: "coop-wins", group: PARTY_GROUP, title: "🤝 Co-op successes", description: "Co-op Dives where the team reached its goal", unit: "count", sql: partyWins("dive", "coop") },
  { id: "sprint", group: QUICK_GROUP, title: "⚡ Sprint", description: "Most depth in 60 seconds", unit: "meters", sql: bestRun("sprint").replace("MAX(r.score)", "MAX(r.score) * 10") },
  { id: "ladder", group: QUICK_GROUP, title: "🪜 Ladder", description: "Highest climb without going more common", unit: "rungs", sql: bestRun("ladder") },
  { id: "roulette", group: QUICK_GROUP, title: "🎯 Rarity Roulette", description: "Most exact tiers hit out of 7", unit: "hits", sql: bestRun("roulette") },
  { id: "five", group: QUICK_GROUP, title: "🖐️ Five Answers", description: "Deepest five answers to one prompt", unit: "meters", sql: bestRun("five").replace("MAX(r.score)", "MAX(r.score) * 10") },
];

/** One finished solo dive, summed up by the single query over plays. */
interface SessionSum {
  player_id: string;
  nickname: string;
  friend_code: string | null;
  mode: "daily" | "unlimited";
  n: number;
  k: number;
  dc: number;
  rare: number;
  ans: number;
  pts: number;
}

type Row = { playerId: string; nickname: string; value: number; code: string | null };

/** Per-player stats per mode, built from the session sums. */
function soloBoards(sessions: SessionSum[]): (Omit<Board, "rows"> & { rows: Row[] })[] {
  type Agg = { nickname: string; code: string | null; dives: number; n: number; k: number; dc: number; rare: number; ans: number; pts: number; best: number };
  const by = { daily: new Map<string, Agg>(), unlimited: new Map<string, Agg>() };
  for (const x of sessions) {
    const m = by[x.mode];
    const a = m.get(x.player_id) ?? { nickname: x.nickname, code: x.friend_code, dives: 0, n: 0, k: 0, dc: 0, rare: 0, ans: 0, pts: 0, best: 0 };
    a.dives++;
    a.n += x.n;
    a.k += x.k;
    a.dc += x.dc;
    a.rare += x.rare;
    a.ans += x.ans;
    a.pts += x.pts;
    a.best = Math.max(a.best, x.pts);
    m.set(x.player_id, a);
  }
  const board = (mode: "daily" | "unlimited", id: string, title: string, description: string, unit: Board["unit"], value: (a: Agg) => number | null) => {
    const rows: Row[] = [];
    for (const [playerId, a] of by[mode]) {
      const v = value(a);
      if (v !== null && v > 0) rows.push({ playerId, nickname: a.nickname, value: v, code: a.code });
    }
    return { id, title, description, unit, group: mode === "daily" ? DAILY_GROUP : UNLIMITED_GROUP, rows };
  };
  const pct = (x: number, n: number) => (n >= MIN_ANSWERS_FOR_RATES ? Math.round((1000 * x) / n) / 10 : null);
  const D = "daily" as const;
  const U = "unlimited" as const;
  return [
    board(D, "daily-best", "🏆 Deepest Daily", "Best depth in a single Daily", "meters", (a) => a.best * 10),
    board(D, "daily-avg", "📏 Best Daily average", "Average Daily depth (5+ Dailies)", "meters", (a) => (a.dives >= 5 ? Math.round(a.pts / a.dives) * 10 : null)),
    board(D, "daily-played", "📅 Most Dailies", "Dailies finished", "count", (a) => a.dives),
    board(D, "daily-krillions", "🐋 Daily One in a Krillions", "The single rarest answer on a Daily question", "count", (a) => a.k),
    board(D, "daily-rare-rate", "💎 Daily rarest taste", `Share of Daily answers that were Deep Cut or rarer (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (a) => pct(a.rare, a.n)),
    board(U, "unlimited-best", "🏆 Deepest Unlimited dive", "Best depth in a single Unlimited dive", "meters", (a) => a.best * 10),
    board(U, "unlimited-krillions", "🐋 Most One in a Krillions", "Unlimited answers that were the rarest on the list", "count", (a) => a.k),
    board(U, "unlimited-deepcuts", "🦑 Most Deep Cuts", "Unlimited Deep Cut answers", "count", (a) => a.dc),
    board(U, "unlimited-rare-rate", "💎 Rarest taste", `Share of Unlimited answers that were Deep Cut or rarer (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (a) => pct(a.rare, a.n)),
    board(U, "unlimited-krillion-rate", "🎯 Krillion hunters", `Share of Unlimited questions answered with the rarest answer (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (a) => (a.k ? pct(a.k, a.n) : null)),
    board(U, "unlimited-accuracy", "✅ Sharpest", `Share of Unlimited questions answered correctly (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (a) => pct(a.ans, a.n)),
    board(U, "unlimited-answered", "🧭 Unlimited explorers", "Unlimited prompts answered correctly", "count", (a) => a.ans),
    board(U, "unlimited-dives", "🤿 Most Unlimited dives", "Unlimited dives finished", "count", (a) => a.dives),
    board(U, "unlimited-total", "🌊 Deepest of all time", "Total depth across every Unlimited dive", "meters", (a) => a.pts * 10),
  ];
}

const GROUP_ORDER = [DAILY_GROUP, UNLIMITED_GROUP, ABYSS_GROUP, PARTY_GROUP, QUICK_GROUP];
const KV_KEY = "lb:v3";
/** How long one computation is shared by everyone (via KV). Keeps D1 reads tiny. */
const SHARED_SECONDS = 20 * 60;

let cache: { at: number; boards: Board[] } | null = null;

/** Top rows with shared ranks for equal values. */
function finish(def: Omit<Board, "rows"> & { rows: Row[] }): Board {
  const rows = [...def.rows].sort((a, b) => b.value - a.value || a.nickname.localeCompare(b.nickname)).slice(0, TOP);
  let rank = 0;
  let prev: number | null = null;
  return {
    ...def,
    rows: rows.map((r, j) => {
      if (r.value !== prev) rank = j + 1;
      prev = r.value;
      return { rank, ...r };
    }),
  };
}

async function computeBoards(env: Env): Promise<Board[]> {
  await Promise.all([ensurePartyTable(env), ensureRuns(env), ensureAbyss(env)]);
  const now = Date.now();
  const [solo, ...results] = await env.DB.batch([
    // One pass over plays for every Daily and Unlimited board: a summary per finished dive.
    env.DB.prepare(
      `SELECT s.player_id, p.nickname, p.friend_code, s.mode, COUNT(*) AS n, SUM(pl.tier = 100) AS k, SUM(pl.tier = 85) AS dc,
              SUM(pl.tier >= 85) AS rare, SUM(pl.answer_id IS NOT NULL) AS ans, SUM(pl.points) AS pts
       FROM sessions s JOIN players p ON p.id = s.player_id JOIN plays pl ON pl.session_id = s.id
       WHERE ${NAMED} AND s.finished = 1 AND s.mode IN ('daily', 'unlimited')
       GROUP BY s.id`,
    ),
    ...SQL_BOARDS.map((b) =>
      env.DB.prepare(
        `SELECT t.player_id, t.value, p.nickname, p.friend_code FROM (${typeof b.sql === "function" ? b.sql(now) : b.sql}) t JOIN players p ON p.id = t.player_id
         WHERE t.value > 0 ORDER BY t.value DESC, p.nickname LIMIT ${TOP}`,
      ),
    ),
  ]);
  const boards = [
    ...soloBoards(solo.results as unknown as SessionSum[]),
    ...SQL_BOARDS.map((b, i) => ({
      id: b.id,
      title: b.title,
      description: b.description,
      unit: b.unit,
      group: b.group,
      rows: (results[i].results as { player_id: string; value: number; nickname: string; friend_code: string | null }[]).map((r) => ({
        playerId: r.player_id,
        nickname: r.nickname,
        value: r.value,
        code: r.friend_code,
      })),
    })),
  ].map(finish);
  // Daily first, then Unlimited, Abyss, Party, Quick modes; within a section, the order above.
  return boards.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

/**
 * Boards are shared through KV for SHARED_SECONDS, so however many people open the
 * page, the database is only asked about once every 20 minutes (plus a short
 * in-memory cache per server instance to save KV reads).
 */
async function getBoards(env: Env, now: number, local: boolean): Promise<{ at: number; boards: Board[] }> {
  if (local) return { at: now, boards: await computeBoards(env) };
  if (cache && now - cache.at < CACHE_SECONDS * 1000) return cache;
  const shared = await env.KV.get<{ at: number; boards: Board[] }>(KV_KEY, "json").catch(() => null);
  if (shared && now - shared.at < SHARED_SECONDS * 1000) return (cache = shared);
  const fresh = { at: now, boards: await computeBoards(env) };
  await env.KV.put(KV_KEY, JSON.stringify(fresh)).catch(() => {});
  return (cache = fresh);
}

leaderboardRoutes.get("/api/leaderboards", async (c: Context<AppEnv>) => {
  const id = c.req.header("X-Player-Id") ?? "";
  if (id && !/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  const now = Date.now();
  // Local dev skips the cache so tests see their own results straight away.
  const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(c.req.url).hostname);
  const current = await getBoards(c.env, now, local);
  // Player ids never leave the server; the client gets each row's public friend
  // code (for friend requests) and whether it's you, a friend, or already asked.
  const rel = id ? await friendStatus(c.env, id) : { friends: new Set<string>(), sent: new Set<string>() };
  return c.json({
    updatedAt: current.at,
    minAnswersForRates: MIN_ANSWERS_FOR_RATES,
    boards: current.boards.map((b) => ({
      ...b,
      rows: b.rows.map(({ playerId, ...r }) => ({
        ...r,
        you: playerId === id,
        friend: rel.friends.has(playerId) ? ("friends" as const) : rel.sent.has(playerId) ? ("sent" as const) : null,
      })),
    })),
  });
});

/**
 * Today's (or any day's) Daily top 10, for the end of the Daily. Reads only that
 * day's rows (indexed by date), cached a minute per server instance.
 */
const dailyTopCache = new Map<string, { at: number; rows: { player_id: string; nickname: string; points: number; tiers: string }[]; total: number }>();

leaderboardRoutes.get("/api/daily/top", async (c: Context<AppEnv>) => {
  const id = c.req.header("X-Player-Id") ?? "";
  const date = String(c.req.query("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Bad date");
  const now = Date.now();
  let entry = dailyTopCache.get(date);
  if (!entry || now - entry.at > 60_000) {
    const [top, count] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT d.player_id, p.nickname, d.points, d.tiers FROM daily_results d JOIN players p ON p.id = d.player_id
         WHERE d.date = ? AND ${NAMED} ORDER BY d.points DESC, d.created_at ASC LIMIT ${TOP}`,
      ).bind(date),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM daily_results WHERE date = ?").bind(date),
    ]);
    entry = { at: now, rows: top.results as never, total: (count.results[0] as { n: number }).n };
    dailyTopCache.set(date, entry);
    if (dailyTopCache.size > 20) dailyTopCache.delete(dailyTopCache.keys().next().value!);
  }
  // Equal depths share a place.
  let rank = 0;
  let prev: number | null = null;
  const rows = entry.rows.map((r, i) => {
    if (r.points !== prev) rank = i + 1;
    prev = r.points;
    return { rank, nickname: r.nickname, depth: r.points * 10, tiers: JSON.parse(r.tiers) as (number | null)[], you: r.player_id === id };
  });
  // Your own place, if you're not in the top 10.
  let you: { rank: number; depth: number } | null = null;
  if (id && !rows.some((r) => r.you)) {
    const mine = await c.env.DB.prepare("SELECT points FROM daily_results WHERE player_id = ? AND date = ?").bind(id, date).first<{ points: number }>();
    if (mine) {
      const above = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM daily_results WHERE date = ? AND points > ?").bind(date, mine.points).first<{ n: number }>();
      you = { rank: (above?.n ?? 0) + 1, depth: mine.points * 10 };
    }
  }
  return c.json({ date, divers: entry.total, rows, you });
});
