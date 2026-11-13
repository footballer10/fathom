import { Hono } from "hono";
import type { Context } from "hono";
import { weekOf } from "./practice";
import { ensurePartyResults, ensureSchema, partyResultStatement } from "./schema";
import { friendStatus } from "./social";
import { looksOf, partyRewards } from "./rewards";
import type { Look } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";

/**
 * Global leaderboards. Only players who have set a name appear on them.
 * Everything is ranked from lb_stats (one summary row per player, kept up to
 * date as games finish; see schema.ts), so a refresh reads one row per player
 * however long the site has been running.
 */

type AppEnv = { Bindings: Env };
export const leaderboardRoutes = new Hono<AppEnv>();

const TOP = 10;
/** Rate boards only count players with enough answers to be meaningful. */
const MIN_ANSWERS_FOR_RATES = 50;
const MIN_PARTY_GAMES_FOR_RATE = 5;
const CACHE_SECONDS = 120;

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
  await ensurePartyResults(env);
  await ensureSchema(env);
  await env.DB.batch(
    results.flatMap((r) => [
      env.DB.prepare(
        "INSERT INTO party_results (kind, variant, room, player_id, rank, player_count, score, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(kind, variant, room, r.playerId, r.rank, results.length, r.score, now),
      partyResultStatement(env, r.playerId, kind, variant, r.rank === 1),
    ]),
  );
  const rewards = await partyRewards(env, room, results, now);
  if (rewards.length) await env.DB.batch(rewards);
}

export interface Board {
  id: string;
  title: string;
  description: string;
  /** Which section of the page it sits in. */
  group: string;
  /** How to show the value. "tier" is a tier's points (shown as its name). */
  unit: "count" | "meters" | "percent" | "days" | "rungs" | "hits" | "tier";
  rows: { rank: number; nickname: string; value: number; playerId: string; code: string | null; look?: Look }[];
}

const NAMED = "p.nickname IS NOT NULL AND TRIM(p.nickname) != ''";

// Sections, in page order.
const DAILY_GROUP = "Daily";
const UNLIMITED_GROUP = "Unlimited";
const ABYSS_GROUP = "Weekly Abyss";
const PARTY_GROUP = "Party";
const QUICK_GROUP = "Quick modes";
const GROUP_ORDER = [DAILY_GROUP, UNLIMITED_GROUP, ABYSS_GROUP, PARTY_GROUP, QUICK_GROUP];

/** One player's summary row (lb_stats) plus their public name and code. */
interface Stats {
  player_id: string;
  nickname: string;
  friend_code: string | null;
  d_dives: number;
  d_n: number;
  d_k: number;
  d_rare: number;
  d_pts: number;
  d_best: number;
  u_dives: number;
  u_n: number;
  u_k: number;
  u_dc: number;
  u_rare: number;
  u_ans: number;
  u_pts: number;
  u_best: number;
  streak_best: number;
  p_games: number;
  p_wins: number;
  w_dive: number;
  w_battle: number;
  w_shark: number;
  w_relay: number;
  w_hotpotato: number;
  w_school: number;
  w_coop: number;
  best_sprint: number;
  best_ladder: number;
  best_roulette: number;
  best_five: number;
  abyss_k: number;
}

type Row = { playerId: string; nickname: string; value: number; code: string | null };
type BoardDef = Omit<Board, "rows"> & { value: (s: Stats) => number | null };

const pct = (x: number, n: number) => (n >= MIN_ANSWERS_FOR_RATES ? Math.round((1000 * x) / n) / 10 : null);
const def = (group: string, id: string, title: string, description: string, unit: Board["unit"], value: BoardDef["value"]): BoardDef => ({
  id,
  group,
  title,
  description,
  unit,
  value,
});

/** Every board ranked from lb_stats, in page order within each section. */
const BOARDS: BoardDef[] = [
  def(DAILY_GROUP, "daily-best", "🏆 Deepest Daily", "Best depth in a single Daily", "meters", (s) => s.d_best * 10),
  def(DAILY_GROUP, "daily-avg", "📏 Best Daily average", "Average Daily depth (5+ Dailies)", "meters", (s) => (s.d_dives >= 5 ? Math.round(s.d_pts / s.d_dives) * 10 : null)),
  def(DAILY_GROUP, "streak", "🔥 Longest Daily streak", "Most Dailies played in a row", "days", (s) => s.streak_best),
  def(DAILY_GROUP, "daily-played", "📅 Most Dailies", "Dailies finished", "count", (s) => s.d_dives),
  def(DAILY_GROUP, "daily-krillions", "🐋 Daily One in a Krillions", "The single rarest answer on a Daily question", "count", (s) => s.d_k),
  def(DAILY_GROUP, "daily-rare-rate", "💎 Daily rarest taste", `Share of Daily answers that were Deep Cut or rarer (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (s) =>
    pct(s.d_rare, s.d_n),
  ),
  def(UNLIMITED_GROUP, "unlimited-best", "🏆 Deepest Unlimited dive", "Best depth in a single Unlimited dive", "meters", (s) => s.u_best * 10),
  def(UNLIMITED_GROUP, "unlimited-krillions", "🐋 Most One in a Krillions", "Unlimited answers that were the rarest on the list", "count", (s) => s.u_k),
  def(UNLIMITED_GROUP, "unlimited-deepcuts", "🦑 Most Deep Cuts", "Unlimited Deep Cut answers", "count", (s) => s.u_dc),
  def(UNLIMITED_GROUP, "unlimited-rare-rate", "💎 Rarest taste", `Share of Unlimited answers that were Deep Cut or rarer (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (s) =>
    pct(s.u_rare, s.u_n),
  ),
  def(UNLIMITED_GROUP, "unlimited-krillion-rate", "🎯 Krillion hunters", `Share of Unlimited questions answered with the rarest answer (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (s) =>
    s.u_k ? pct(s.u_k, s.u_n) : null,
  ),
  def(UNLIMITED_GROUP, "unlimited-accuracy", "✅ Sharpest", `Share of Unlimited questions answered correctly (${MIN_ANSWERS_FOR_RATES}+ questions)`, "percent", (s) =>
    pct(s.u_ans, s.u_n),
  ),
  def(UNLIMITED_GROUP, "unlimited-answered", "🧭 Unlimited explorers", "Unlimited prompts answered correctly", "count", (s) => s.u_ans),
  def(UNLIMITED_GROUP, "unlimited-dives", "🤿 Most Unlimited dives", "Unlimited dives finished", "count", (s) => s.u_dives),
  def(UNLIMITED_GROUP, "unlimited-total", "🌊 Deepest of all time", "Total depth across every Unlimited dive", "meters", (s) => s.u_pts * 10),
  def(ABYSS_GROUP, "abyss-krillions", "🐋 Abyss krillions", "Weeks where your Abyss answer was a One in a Krillion", "count", (s) => s.abyss_k),
  def(PARTY_GROUP, "party-win-rate", "Party win rate", `Share of party games won, every mode (${MIN_PARTY_GAMES_FOR_RATE}+ games)`, "percent", (s) =>
    s.p_games >= MIN_PARTY_GAMES_FOR_RATE ? Math.round((1000 * s.p_wins) / s.p_games) / 10 : null,
  ),
  def(PARTY_GROUP, "dive-wins", "🌊 Party Dive wins", "Group Dive games won", "count", (s) => s.w_dive),
  def(PARTY_GROUP, "battle-wins", "🐡 Battle wins", "Last diver standing in Battle", "count", (s) => s.w_battle),
  def(PARTY_GROUP, "shark-wins", "🦈 Shark Tank survivors", "Shark Tank games survived to the end", "count", (s) => s.w_shark),
  def(PARTY_GROUP, "relay-wins", "🔤 Relay wins", "Relay games won with your team", "count", (s) => s.w_relay),
  def(PARTY_GROUP, "hotpotato-wins", "🥔 Hot Potato wins", "Hot Potato games won", "count", (s) => s.w_hotpotato),
  def(PARTY_GROUP, "school-wins", "🐟 School of Fish wins", "School of Fish games won", "count", (s) => s.w_school),
  def(PARTY_GROUP, "coop-wins", "🤝 Co-op successes", "Co-op Dives where the team reached its goal", "count", (s) => s.w_coop),
  def(QUICK_GROUP, "sprint", "⚡ Sprint", "Most depth in 60 seconds", "meters", (s) => s.best_sprint * 10),
  def(QUICK_GROUP, "ladder", "🪜 Ladder", "Highest climb without going more common", "rungs", (s) => s.best_ladder),
  def(QUICK_GROUP, "roulette", "🎯 Rarity Roulette", "Most exact tiers hit out of 7", "hits", (s) => s.best_roulette),
  def(QUICK_GROUP, "five", "🖐️ Five Answers", "Deepest five answers to one prompt", "meters", (s) => s.best_five * 10),
];

const KV_KEY = "lb:v4";
/** How long one computation is shared by everyone (via KV). Keeps D1 reads tiny. */
const SHARED_SECONDS = 20 * 60;

let cache: { at: number; boards: Board[] } | null = null;
let retryAt = 0;
let inflight: Promise<Board[]> | null = null;
const JITTER_MS = Math.random() * 5 * 60_000;

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

/** The parts of a look shown next to a name. */
function publicLook(l: Look): Look {
  return { ...(l.title ? { title: l.title } : {}), ...(l.color ? { color: l.color } : {}), ...(l.skin ? { skin: l.skin } : {}) };
}

async function computeBoards(env: Env): Promise<Board[]> {
  await ensureSchema(env);
  const now = Date.now();
  const [stats, abyss] = await env.DB.batch([
    // One row per named player: every board below is worked out from this in memory.
    env.DB.prepare(`SELECT l.*, p.nickname, p.friend_code FROM lb_stats l JOIN players p ON p.id = l.player_id WHERE ${NAMED}`),
    // This week's Abyss, straight off its index (top 10 only).
    env.DB.prepare(
      `SELECT a.player_id AS player_id, a.best_tier AS value, p.nickname, p.friend_code FROM abyss_attempts a JOIN players p ON p.id = a.player_id
       WHERE a.week = ? AND a.best_tier IS NOT NULL AND ${NAMED} ORDER BY a.best_tier DESC, (a.best_at - a.started_at) LIMIT ${TOP}`,
    ).bind(weekOf(now).week),
  ]);
  const all = stats.results as unknown as Stats[];
  const boards: Board[] = BOARDS.map(({ value, ...b }) => {
    const rows: Row[] = [];
    for (const s of all) {
      const v = value(s);
      if (v !== null && v > 0) rows.push({ playerId: s.player_id, nickname: s.nickname, value: v, code: s.friend_code });
    }
    return finish({ ...b, rows });
  });
  boards.push(
    finish({
      id: "abyss-week",
      group: ABYSS_GROUP,
      title: "🕳️ This week's Abyss",
      description: "Rarest answer in this week's dive",
      unit: "tier",
      rows: (abyss.results as { player_id: string; value: number; nickname: string; friend_code: string | null }[]).map((r) => ({
        playerId: r.player_id,
        nickname: r.nickname,
        value: r.value,
        code: r.friend_code,
      })),
    }),
  );
  // Daily first, then Unlimited, Abyss, Party, Quick modes; within a section, the order above
  // (This week's Abyss leads its section).
  const order = (b: Board) => GROUP_ORDER.indexOf(b.group) * 100 + (b.id === "abyss-week" ? -1 : BOARDS.findIndex((d) => d.id === b.id));
  // Titles and name colours from the shop, for everyone shown.
  const looks = await looksOf(env, [...new Set(boards.flatMap((b) => b.rows.map((r) => r.playerId)))]).catch(() => new Map<string, Look>());
  for (const b of boards) for (const r of b.rows) if (looks.has(r.playerId)) r.look = publicLook(looks.get(r.playerId)!);
  return boards.sort((a, b) => order(a) - order(b));
}

/**
 * Boards are shared through KV for SHARED_SECONDS, so however many people open the
 * page, the database is only asked about once every 20 minutes (plus a short
 * in-memory cache per server instance to save KV reads).
 */
async function getBoards(env: Env, now: number, local: boolean): Promise<{ at: number; boards: Board[] }> {
  if (local) return { at: now, boards: await computeBoards(env) };
  if (cache && (now - cache.at < CACHE_SECONDS * 1000 || now < retryAt)) return cache;
  const shared = await env.KV.get<{ at: number; boards: Board[] }>(KV_KEY, "json").catch(() => null);
  // Each server instance waits a slightly different extra time before refreshing, so they
  // don't all hit the database at the same moment when the shared copy expires.
  if (shared && now - shared.at < SHARED_SECONDS * 1000 + JITTER_MS) return (cache = shared);
  try {
    // Requests arriving while a refresh is running share it.
    inflight ??= computeBoards(env).finally(() => (inflight = null));
    const fresh = { at: now, boards: await inflight };
    await env.KV.put(KV_KEY, JSON.stringify(fresh)).catch(() => {});
    return (cache = fresh);
  } catch (err) {
    // If the database is unavailable, keep showing the last boards we had rather than an error.
    const stale = shared ?? cache;
    if (stale) {
      cache = stale;
      console.error("leaderboards: serving last saved boards", err);
      retryAt = now + 60_000; // don't ask the database again for a minute
      return stale;
    }
    throw err;
  }
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
 * Today's (or any day's) Daily top 10, for the end of the Daily. Reads about ten
 * rows off an index plus the per-score summary, cached a minute per server instance.
 */
const dailyTopCache = new Map<
  string,
  { at: number; rows: { player_id: string; nickname: string; points: number; tiers: string }[]; total: number; looks: Map<string, Look> }
>();

leaderboardRoutes.get("/api/daily/top", async (c: Context<AppEnv>) => {
  const id = c.req.header("X-Player-Id") ?? "";
  const date = String(c.req.query("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Bad date");
  const now = Date.now();
  let entry = dailyTopCache.get(date);
  if (!entry || now - entry.at > 60_000) {
    await ensureSchema(c.env);
    // Top 10 straight off the (date, points) index; the diver count from the per-score summary.
    const [top, count] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT d.player_id, p.nickname, d.points, d.tiers FROM daily_results d INDEXED BY idx_daily_results_top JOIN players p ON p.id = d.player_id
         WHERE d.date = ? AND ${NAMED} ORDER BY d.points DESC, d.created_at ASC LIMIT ${TOP}`,
      ).bind(date),
      c.env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM daily_hist WHERE date = ?").bind(date),
    ]);
    const rows = top.results as { player_id: string; nickname: string; points: number; tiers: string }[];
    const looks = await looksOf(c.env, rows.map((r) => r.player_id)).catch(() => new Map<string, Look>());
    entry = { at: now, rows, total: (count.results[0] as { n: number }).n, looks };
    dailyTopCache.set(date, entry);
    if (dailyTopCache.size > 20) dailyTopCache.delete(dailyTopCache.keys().next().value!);
  }
  // Equal depths share a place.
  let rank = 0;
  let prev: number | null = null;
  const rows = entry.rows.map((r, i) => {
    if (r.points !== prev) rank = i + 1;
    prev = r.points;
    const look = entry!.looks.get(r.player_id);
    return {
      rank,
      nickname: r.nickname,
      depth: r.points * 10,
      tiers: JSON.parse(r.tiers) as (number | null)[],
      you: r.player_id === id,
      ...(look ? { look: publicLook(look) } : {}),
    };
  });
  // Your own place, if you're not in the top 10.
  let you: { rank: number; depth: number } | null = null;
  if (id && !rows.some((r) => r.you)) {
    const mine = await c.env.DB.prepare("SELECT points FROM daily_results WHERE player_id = ? AND date = ?").bind(id, date).first<{ points: number }>();
    if (mine) {
      const above = await c.env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM daily_hist WHERE date = ? AND points > ?").bind(date, mine.points).first<{ n: number }>();
      you = { rank: (above?.n ?? 0) + 1, depth: mine.points * 10 };
    }
  }
  return c.json({ date, divers: entry.total, rows, you });
});

/** Forget every saved copy of the boards (after the admin portal removes a dive), so the next view is fresh. */
export async function clearLeaderboardCache(env: Env) {
  cache = null;
  retryAt = 0;
  dailyTopCache.clear();
  await env.KV.delete(KV_KEY).catch(() => {});
}
