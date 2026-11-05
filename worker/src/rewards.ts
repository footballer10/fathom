import { Hono } from "hono";
import type { Context } from "hono";
import {
  ACHIEVEMENTS,
  DEFAULT_LOOK,
  ITEM_BY_ID,
  PEARLS,
  SLOTS,
  STREAK_MILESTONES,
  cleanLook,
  dailyQuests,
  ownsItem,
  weeklyQuests,
} from "@fathom/shared";
import type { AchievementStats, Look, QuestMetric, Slot } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { today } from "./questions";
import { weekOf } from "./practice";

/**
 * Pearls, quests and the shop (the catalog lives in shared/src/rewards.ts).
 *
 * Tables:
 *  - wallet:         one row per player: balance, lifetime pearls, owned items, equipped look.
 *  - reward_claims:  one row per reward ever paid (its key makes every reward pay once).
 *  - quest_progress: per player, per day ("d:2026-11-05") and per week ("w:2026-11-02"),
 *                    a running count for each quest metric. A few rows per player per day.
 *
 * Every payout is three statements in one batch: insert the claim (ignored if that key
 * was already paid), then add the pearls only if the claim row carries this attempt's
 * random nonce. So a double tap or a retry can never pay twice.
 */

type AppEnv = { Bindings: Env };
export const rewardRoutes = new Hono<AppEnv>();

export interface Earn {
  key: string;
  pearls: number;
  label: string;
  items?: string[];
}

export interface Earned {
  pearls: number;
  lines: { label: string; pearls: number }[];
  items: string[];
}

let ready = false;
export async function ensureRewards(env: Env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS wallet (
         player_id TEXT PRIMARY KEY, pearls INTEGER NOT NULL DEFAULT 0, lifetime INTEGER NOT NULL DEFAULT 0,
         owned TEXT NOT NULL DEFAULT '[]', look TEXT NOT NULL DEFAULT '{}')`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS reward_claims (
         player_id TEXT NOT NULL, key TEXT NOT NULL, pearls INTEGER NOT NULL, label TEXT NOT NULL,
         nonce TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (player_id, key))`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_reward_claims_recent ON reward_claims(player_id, created_at)"),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS quest_progress (
         player_id TEXT NOT NULL, period TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL,
         PRIMARY KEY (player_id, period, metric))`,
    ),
  ]);
  ready = true;
}

/** Statements that pay out each reward exactly once (see the note at the top). */
export function earnStatements(env: Env, playerId: string, earns: Earn[], now: number): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  if (!earns.length) return out;
  out.push(env.DB.prepare("INSERT OR IGNORE INTO wallet (player_id) VALUES (?)").bind(playerId));
  for (const e of earns) {
    const nonce = crypto.randomUUID();
    const paid = "EXISTS (SELECT 1 FROM reward_claims WHERE player_id = ?1 AND key = ?2 AND nonce = ?3)";
    out.push(
      env.DB.prepare("INSERT OR IGNORE INTO reward_claims (player_id, key, pearls, label, nonce, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        playerId,
        e.key,
        e.pearls,
        e.label.slice(0, 80),
        nonce,
        now,
      ),
      env.DB.prepare(`UPDATE wallet SET pearls = pearls + ?4, lifetime = lifetime + ?4 WHERE player_id = ?1 AND ${paid}`).bind(playerId, e.key, nonce, e.pearls),
    );
    for (const item of e.items ?? []) {
      out.push(
        env.DB.prepare(
          `UPDATE wallet SET owned = json_insert(owned, '$[#]', ?4) WHERE player_id = ?1 AND ${paid}
             AND NOT EXISTS (SELECT 1 FROM json_each(wallet.owned) WHERE value = ?4)`,
        ).bind(playerId, e.key, nonce, item),
      );
    }
  }
  return out;
}

export function summarize(earns: Earn[]): Earned {
  return {
    pearls: earns.reduce((n, e) => n + e.pearls, 0),
    lines: earns.map((e) => ({ label: e.label, pearls: e.pearls })),
    items: earns.flatMap((e) => e.items ?? []),
  };
}

/** Add to today's and this week's quest counts ("best" keeps the maximum instead). */
export function progressStatements(env: Env, playerId: string, now: number, deltas: Partial<Record<QuestMetric, number>>): D1PreparedStatement[] {
  const periods = [`d:${today(now)}`, `w:${weekOf(now).week}`];
  const out: D1PreparedStatement[] = [];
  for (const [metric, n] of Object.entries(deltas) as [QuestMetric, number][]) {
    if (!n) continue;
    const update = metric === "best" ? "n = MAX(n, excluded.n)" : "n = n + excluded.n";
    for (const p of periods) {
      out.push(
        env.DB.prepare(`INSERT INTO quest_progress (player_id, period, metric, n) VALUES (?, ?, ?, ?) ON CONFLICT(player_id, period, metric) DO UPDATE SET ${update}`).bind(
          playerId,
          p,
          metric,
          n,
        ),
      );
    }
  }
  return out;
}

/** Quest counts from a list of answered prompts (tier null = missed). */
export function answerDeltas(tiers: (number | null)[]): Partial<Record<QuestMetric, number>> {
  return {
    ans: tiers.filter((t) => t !== null).length,
    rare: tiers.filter((t) => (t ?? 0) >= 60).length,
    deep: tiers.filter((t) => (t ?? 0) >= 85).length,
    k: tiers.filter((t) => t === 100).length,
  };
}

/** How many of a metric this player has today (for the per-day payout caps). */
async function todayCount(env: Env, playerId: string, metric: QuestMetric, now: number): Promise<number> {
  const r = await env.DB.prepare("SELECT n FROM quest_progress WHERE player_id = ? AND period = ? AND metric = ?")
    .bind(playerId, `d:${today(now)}`, metric)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Rewards for a finished Daily or Unlimited dive. Call before the dive's stats
 * are written (it reads the streak as it was, to know what it becomes).
 */
export async function soloRewards(
  env: Env,
  playerId: string,
  mode: "daily" | "unlimited",
  date: string | null,
  sessionId: string,
  tiers: (number | null)[],
  points: number,
  now: number,
): Promise<{ stmts: D1PreparedStatement[]; earned: Earned }> {
  await ensureRewards(env);
  const earns: Earn[] = [];
  if (mode === "daily" && date) {
    earns.push({ key: `daily:${date}`, pearls: PEARLS.daily(points), label: "Finished the Daily" });
    const s = await env.DB.prepare("SELECT streak_cur, streak_last FROM lb_stats WHERE player_id = ?")
      .bind(playerId)
      .first<{ streak_cur: number; streak_last: string | null }>();
    const streak = s?.streak_last === dayBefore(date) ? s.streak_cur + 1 : s?.streak_last === date ? s.streak_cur : 1;
    const m = STREAK_MILESTONES.find((x) => x.days === streak);
    if (m) earns.push({ key: `streak:${m.days}:${date}`, pearls: m.pearls, label: `${m.days}-day Daily streak!`, items: m.items });
  } else if (mode === "unlimited") {
    if ((await todayCount(env, playerId, "unl", now)) < PEARLS.dailyCaps.unlimited) {
      earns.push({ key: `unl:${sessionId}`, pearls: PEARLS.unlimited(points), label: "Finished an Unlimited dive" });
    }
  }
  const stmts = [
    ...earnStatements(env, playerId, earns, now),
    ...progressStatements(env, playerId, now, { [mode === "daily" ? "daily" : "unl"]: 1, best: points, ...answerDeltas(tiers) }),
  ];
  return { stmts, earned: summarize(earns) };
}

/** Rewards for a finished quick-mode run. */
export async function quickRewards(env: Env, playerId: string, runId: string, tiers: number[], now: number) {
  await ensureRewards(env);
  const earns: Earn[] = [];
  if ((await todayCount(env, playerId, "quick", now)) < PEARLS.dailyCaps.quick) {
    earns.push({ key: `run:${runId}`, pearls: PEARLS.quick, label: "Finished a quick-mode run" });
  }
  const stmts = [...earnStatements(env, playerId, earns, now), ...progressStatements(env, playerId, now, { quick: 1, ...answerDeltas(tiers) })];
  return { stmts, earned: summarize(earns) };
}

/** Rewards for everyone in a finished party game. */
export async function partyRewards(env: Env, room: string, results: { playerId: string; rank: number }[], now: number): Promise<D1PreparedStatement[]> {
  await ensureRewards(env);
  const date = today(now);
  const ids = results.map((r) => r.playerId);
  const { results: counts } = await env.DB.prepare(
    `SELECT player_id, n FROM quest_progress WHERE period = ? AND metric = 'party' AND player_id IN (SELECT value FROM json_each(?))`,
  )
    .bind(`d:${date}`, JSON.stringify(ids))
    .all<{ player_id: string; n: number }>();
  const played = new Map(counts.map((c) => [c.player_id, c.n]));
  return results.flatMap((r) => {
    const won = r.rank === 1;
    const earns: Earn[] =
      (played.get(r.playerId) ?? 0) < PEARLS.dailyCaps.party
        ? [{ key: `party:${room}:${now}`, pearls: PEARLS.party + (won ? PEARLS.partyWin : 0), label: won ? "Won a party game" : "Played a party game" }]
        : [];
    return [...earnStatements(env, r.playerId, earns, now), ...progressStatements(env, r.playerId, now, { party: 1, pwin: won ? 1 : 0 })];
  });
}

/** The Weekly Abyss: once for diving in, once more for a One in a Krillion. */
export async function abyssRewards(env: Env, playerId: string, week: string, kind: "dive" | "krillion", now: number) {
  await ensureRewards(env);
  const earns: Earn[] =
    kind === "dive"
      ? [{ key: `abyss:${week}`, pearls: PEARLS.abyss, label: "Took the Weekly Abyss dive" }]
      : [{ key: `abyssk:${week}`, pearls: PEARLS.abyssKrillion, label: "One in a Krillion in the Abyss!" }];
  const deltas = kind === "dive" ? { abyss: 1 } : { k: 1 };
  await env.DB.batch([...earnStatements(env, playerId, earns, now), ...progressStatements(env, playerId, now, deltas)]);
}

// ---------------------------------------------------------------------------
// Looks (what other people see)
// ---------------------------------------------------------------------------

interface WalletRow {
  player_id: string;
  pearls: number;
  lifetime: number;
  owned: string;
  look: string;
}

function parseLook(row: Pick<WalletRow, "owned" | "look"> | null | undefined): Look {
  if (!row) return {};
  try {
    return cleanLook(JSON.parse(row.look), JSON.parse(row.owned) as string[]);
  } catch {
    return {};
  }
}

/** Equipped looks for some players (missing players have the default look). */
export async function looksOf(env: Env, playerIds: string[]): Promise<Map<string, Look>> {
  const out = new Map<string, Look>();
  if (!playerIds.length) return out;
  await ensureRewards(env);
  for (let i = 0; i < playerIds.length; i += 90) {
    const chunk = playerIds.slice(i, i + 90);
    const { results } = await env.DB.prepare("SELECT player_id, owned, look FROM wallet WHERE player_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(chunk))
      .all<WalletRow>();
    for (const r of results) {
      const look = parseLook(r);
      if (Object.keys(look).length) out.set(r.player_id, look);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function pid(c: Context<AppEnv>): string {
  const id = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  return id;
}

async function wallet(env: Env, playerId: string): Promise<WalletRow> {
  const row = await env.DB.prepare("SELECT * FROM wallet WHERE player_id = ?").bind(playerId).first<WalletRow>();
  return row ?? { player_id: playerId, pearls: 0, lifetime: 0, owned: "[]", look: "{}" };
}

async function achievementStats(env: Env, playerId: string, lifetime: number): Promise<AchievementStats> {
  const s = await env.DB.prepare("SELECT d_dives, d_k, u_k, abyss_k, d_rare, u_rare, p_wins, d_best, streak_best FROM lb_stats WHERE player_id = ?")
    .bind(playerId)
    .first<Record<string, number>>()
    .catch(() => null);
  return {
    dailies: s?.d_dives ?? 0,
    krillions: (s?.d_k ?? 0) + (s?.u_k ?? 0) + (s?.abyss_k ?? 0),
    deepCuts: (s?.d_rare ?? 0) + (s?.u_rare ?? 0),
    partyWins: s?.p_wins ?? 0,
    bestDailyPoints: s?.d_best ?? 0,
    bestStreak: s?.streak_best ?? 0,
    lifetimePearls: lifetime,
  };
}

/** Everything the rewards screens show, for one player. */
async function status(env: Env, playerId: string, now: number) {
  await ensureRewards(env);
  const date = today(now);
  const { week, endsAt } = weekOf(now);
  const dq = dailyQuests(date);
  const wq = weeklyQuests(week);
  const w = await wallet(env, playerId);
  const owned = JSON.parse(w.owned) as string[];
  const ach = await achievementStats(env, playerId, w.lifetime);
  const keys = [...dq.map((q) => `q:${date}:${q.id}`), ...wq.map((q) => `q:${week}:${q.id}`), ...ACHIEVEMENTS.map((a) => `ach:${a.id}`)];
  const [progress, claimed, recent, streak] = await env.DB.batch([
    env.DB.prepare("SELECT period, metric, n FROM quest_progress WHERE player_id = ? AND period IN (?, ?)").bind(playerId, `d:${date}`, `w:${week}`),
    env.DB.prepare("SELECT key FROM reward_claims WHERE player_id = ? AND key IN (SELECT value FROM json_each(?))").bind(playerId, JSON.stringify(keys)),
    env.DB.prepare("SELECT label, pearls, created_at AS at FROM reward_claims WHERE player_id = ? ORDER BY created_at DESC LIMIT 20").bind(playerId),
    env.DB.prepare("SELECT streak_cur, streak_last FROM lb_stats WHERE player_id = ?").bind(playerId),
  ]);
  const prog = new Map((progress.results as { period: string; metric: string; n: number }[]).map((r) => [`${r.period}|${r.metric}`, r.n]));
  const done = new Set((claimed.results as { key: string }[]).map((r) => r.key));
  const s = streak.results[0] as { streak_cur: number; streak_last: string | null } | undefined;
  const currentStreak = s && (s.streak_last === date || s.streak_last === dayBefore(date)) ? s.streak_cur : 0;
  const quest = (period: string, prefix: string) => (q: (typeof dq)[number]) => ({
    ...q,
    progress: Math.min(q.target, prog.get(`${prefix}:${period}|${q.metric}`) ?? 0),
    claimed: done.has(`q:${period}:${q.id}`),
  });
  return {
    pearls: w.pearls,
    lifetime: w.lifetime,
    owned,
    look: parseLook(w),
    daily: { date, quests: dq.map(quest(date, "d")) },
    weekly: { week, endsAt, quests: wq.map(quest(week, "w")) },
    streak: {
      current: currentStreak,
      playedToday: s?.streak_last === date,
      milestones: STREAK_MILESTONES.map((m) => ({ ...m, reached: ach.bestStreak >= m.days })),
    },
    achievements: ACHIEVEMENTS.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      pearls: a.pearls,
      items: a.items,
      target: a.target,
      progress: Math.min(a.target, a.value(ach)),
      claimed: done.has(`ach:${a.id}`),
    })),
    recent: recent.results,
  };
}

rewardRoutes.get("/api/rewards", async (c) => c.json(await status(c.env, pid(c), Date.now())));

/** Collect a finished quest or achievement. */
rewardRoutes.post("/api/rewards/claim", async (c) => {
  const playerId = pid(c);
  const now = Date.now();
  const { kind, id } = await c.req.json<{ kind?: string; id?: string }>().catch(() => ({ kind: "", id: "" }));
  const st = await status(c.env, playerId, now);
  let earn: Earn | null = null;
  if (kind === "quest") {
    const daily = st.daily.quests.find((q) => q.id === id);
    const weekly = st.weekly.quests.find((q) => q.id === id);
    const q = daily ?? weekly;
    if (!q) throw new HttpError(400, "That quest isn't active right now");
    if (q.claimed) throw new HttpError(400, "Already collected");
    if (q.progress < q.target) throw new HttpError(400, "That quest isn't finished yet");
    earn = { key: `q:${daily ? st.daily.date : st.weekly.week}:${q.id}`, pearls: q.pearls, label: `Quest: ${q.label}` };
  } else if (kind === "achievement") {
    const a = st.achievements.find((x) => x.id === id);
    if (!a) throw new HttpError(400, "No such achievement");
    if (a.claimed) throw new HttpError(400, "Already collected");
    if (a.progress < a.target) throw new HttpError(400, "Not there yet");
    earn = { key: `ach:${a.id}`, pearls: a.pearls, label: `Achievement: ${a.name}`, items: a.items };
  } else {
    throw new HttpError(400, "Unknown reward");
  }
  await c.env.DB.batch(earnStatements(c.env, playerId, [earn], now));
  return c.json(await status(c.env, playerId, now));
});

rewardRoutes.post("/api/shop/buy", async (c) => {
  const playerId = pid(c);
  const { id } = await c.req.json<{ id?: string }>().catch(() => ({ id: "" }));
  const item = ITEM_BY_ID.get(String(id));
  if (!item) throw new HttpError(400, "No such item");
  if (item.price === null) throw new HttpError(400, `This one can't be bought. ${item.unlock ?? ""}`.trim());
  await ensureRewards(c.env);
  const w = await wallet(c.env, playerId);
  const owned = JSON.parse(w.owned) as string[];
  if (ownsItem(owned, item.id)) throw new HttpError(400, "You already have this");
  if (w.pearls < item.price) throw new HttpError(400, `You need ${item.price - w.pearls} more pearls`);
  // Only succeeds if nothing changed since we read the wallet (no double spending).
  const res = await c.env.DB.prepare("UPDATE wallet SET pearls = pearls - ?, owned = ? WHERE player_id = ? AND pearls >= ? AND owned = ?")
    .bind(item.price, JSON.stringify([...owned, item.id]), playerId, item.price, w.owned)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "Something changed. Try again.");
  return c.json(await status(c.env, playerId, Date.now()));
});

rewardRoutes.post("/api/shop/equip", async (c) => {
  const playerId = pid(c);
  const { slot, id } = await c.req.json<{ slot?: string; id?: string }>().catch(() => ({ slot: "", id: "" }));
  if (!SLOTS.includes(slot as Slot)) throw new HttpError(400, "Unknown slot");
  const itemId = String(id || DEFAULT_LOOK[slot as Slot]);
  const item = ITEM_BY_ID.get(itemId);
  if (!item || item.slot !== slot) throw new HttpError(400, "That doesn't go there");
  await ensureRewards(c.env);
  const w = await wallet(c.env, playerId);
  const owned = JSON.parse(w.owned) as string[];
  if (!ownsItem(owned, itemId)) throw new HttpError(400, "You don't own that yet");
  const look = { ...parseLook(w), [slot as Slot]: itemId };
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO wallet (player_id) VALUES (?)").bind(playerId),
    c.env.DB.prepare("UPDATE wallet SET look = ? WHERE player_id = ?").bind(JSON.stringify(cleanLook(look, owned)), playerId),
  ]);
  return c.json(await status(c.env, playerId, Date.now()));
});
