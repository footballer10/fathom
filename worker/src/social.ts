import { Hono } from "hono";
import type { Context } from "hono";
import { nicknameProblem, pointsToDepth, zoneForDepth } from "@fathom/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { dailyNumber, today } from "./questions";

/** Player profile (nickname, friend code), friends leaderboard, and the Daily archive. */

type AppEnv = { Bindings: Env };
export const friendRoutes = new Hono<AppEnv>();

const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function pid(c: Context<AppEnv>): string {
  const id = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  return id;
}

async function profile(env: Env, playerId: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO players (id, created_at) VALUES (?, ?)").bind(playerId, Date.now()).run();
  let row = await env.DB.prepare("SELECT nickname, friend_code FROM players WHERE id = ?").bind(playerId).first<{
    nickname: string | null;
    friend_code: string | null;
  }>();
  if (!row?.friend_code) {
    // Friend codes are 6 characters with no look-alikes (no 0/O, 1/I/L).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("");
      const res = await env.DB.prepare("UPDATE players SET friend_code = ? WHERE id = ? AND friend_code IS NULL").bind(code, playerId).run().catch(() => null);
      if (res?.meta.changes) break;
    }
    row = await env.DB.prepare("SELECT nickname, friend_code FROM players WHERE id = ?").bind(playerId).first();
  }
  return { nickname: row?.nickname ?? null, friendCode: row?.friend_code ?? null };
}

friendRoutes.get("/api/player", async (c) => c.json(await profile(c.env, pid(c))));

friendRoutes.post("/api/player", async (c) => {
  const playerId = pid(c);
  const { nickname } = await c.req.json<{ nickname?: string }>().catch(() => ({ nickname: "" }));
  const problem = nicknameProblem(nickname ?? "");
  if (problem) throw new HttpError(400, problem);
  await profile(c.env, playerId);
  await c.env.DB.prepare("UPDATE players SET nickname = ? WHERE id = ?").bind(nickname!.trim(), playerId).run();
  return c.json(await profile(c.env, playerId));
});

friendRoutes.post("/api/friends", async (c) => {
  const playerId = pid(c);
  const { code } = await c.req.json<{ code?: string }>().catch(() => ({ code: "" }));
  const friend = await c.env.DB.prepare("SELECT id, nickname FROM players WHERE friend_code = ?")
    .bind(String(code ?? "").trim().toUpperCase())
    .first<{ id: string; nickname: string | null }>();
  if (!friend) throw new HttpError(404, "No player has that friend code");
  if (friend.id === playerId) throw new HttpError(400, "That's your own code");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?)").bind(playerId, friend.id, now),
    c.env.DB.prepare("INSERT OR IGNORE INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?)").bind(friend.id, playerId, now),
  ]);
  return c.json({ ok: true, nickname: friend.nickname });
});

friendRoutes.delete("/api/friends/:code", async (c) => {
  const playerId = pid(c);
  const friend = await c.env.DB.prepare("SELECT id FROM players WHERE friend_code = ?").bind(c.req.param("code").toUpperCase()).first<{ id: string }>();
  if (friend) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM friends WHERE player_id = ? AND friend_id = ?").bind(playerId, friend.id),
      c.env.DB.prepare("DELETE FROM friends WHERE player_id = ? AND friend_id = ?").bind(friend.id, playerId),
    ]);
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Friend requests (sent by tapping a name on the global leaderboards)
// ---------------------------------------------------------------------------

let requestsTableReady = false;
async function ensureRequestsTable(env: Env) {
  if (requestsTableReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS friend_requests (
         from_id TEXT NOT NULL, to_id TEXT NOT NULL, created_at INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY (from_id, to_id))`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id, status)"),
  ]);
  requestsTableReady = true;
}

async function makeFriends(env: Env, a: string, b: string, now: number) {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?)").bind(a, b, now),
    env.DB.prepare("INSERT OR IGNORE INTO friends (player_id, friend_id, created_at) VALUES (?, ?, ?)").bind(b, a, now),
    env.DB.prepare("UPDATE friend_requests SET status = 'accepted' WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").bind(a, b, b, a),
  ]);
}

async function playerByCode(env: Env, code: string) {
  return env.DB.prepare("SELECT id, nickname FROM players WHERE friend_code = ?")
    .bind(String(code ?? "").trim().toUpperCase())
    .first<{ id: string; nickname: string | null }>();
}

/** Send a request. If they already asked you, you're friends straight away. */
friendRoutes.post("/api/friends/requests", async (c) => {
  const playerId = pid(c);
  await ensureRequestsTable(c.env);
  const { code } = await c.req.json<{ code?: string }>().catch(() => ({ code: "" }));
  const to = await playerByCode(c.env, code ?? "");
  if (!to) throw new HttpError(404, "That player couldn't be found");
  if (to.id === playerId) throw new HttpError(400, "That's you!");
  const now = Date.now();
  const already = await c.env.DB.prepare("SELECT 1 FROM friends WHERE player_id = ? AND friend_id = ?").bind(playerId, to.id).first();
  if (already) return c.json({ status: "friends", nickname: to.nickname });
  const theyAsked = await c.env.DB.prepare("SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'").bind(to.id, playerId).first();
  if (theyAsked) {
    await makeFriends(c.env, playerId, to.id, now);
    return c.json({ status: "friends", nickname: to.nickname });
  }
  // Re-sending after a decline is allowed; it simply becomes pending again.
  await c.env.DB.prepare(
    `INSERT INTO friend_requests (from_id, to_id, created_at, status) VALUES (?, ?, ?, 'pending')
     ON CONFLICT(from_id, to_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at`,
  )
    .bind(playerId, to.id, now)
    .run();
  return c.json({ status: "sent", nickname: to.nickname });
});

/** Requests waiting for you to answer. */
friendRoutes.get("/api/friends/requests", async (c) => {
  const playerId = pid(c);
  await ensureRequestsTable(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT p.nickname, p.friend_code, r.created_at FROM friend_requests r JOIN players p ON p.id = r.from_id
     WHERE r.to_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC LIMIT 50`,
  )
    .bind(playerId)
    .all<{ nickname: string | null; friend_code: string; created_at: number }>();
  return c.json({ requests: results.map((r) => ({ nickname: r.nickname ?? "A diver", code: r.friend_code, at: r.created_at })) });
});

friendRoutes.post("/api/friends/requests/:code/:answer", async (c) => {
  const playerId = pid(c);
  await ensureRequestsTable(c.env);
  const from = await playerByCode(c.env, c.req.param("code"));
  if (!from) throw new HttpError(404, "That player couldn't be found");
  if (c.req.param("answer") === "accept") await makeFriends(c.env, playerId, from.id, Date.now());
  else await c.env.DB.prepare("UPDATE friend_requests SET status = 'declined' WHERE from_id = ? AND to_id = ?").bind(from.id, playerId).run();
  return c.json({ ok: true });
});

/** Who you're friends with or have asked, by friend code (for the leaderboard pop-up). */
export async function friendStatus(env: Env, playerId: string): Promise<{ friends: Set<string>; sent: Set<string> }> {
  await ensureRequestsTable(env);
  const [f, r] = await env.DB.batch([
    env.DB.prepare("SELECT friend_id AS id FROM friends WHERE player_id = ?").bind(playerId),
    env.DB.prepare("SELECT to_id AS id FROM friend_requests WHERE from_id = ? AND status = 'pending'").bind(playerId),
  ]);
  return {
    friends: new Set((f.results as { id: string }[]).map((x) => x.id)),
    sent: new Set((r.results as { id: string }[]).map((x) => x.id)),
  };
}

/** Today's Daily results for you and your friends, plus 7-day totals. */
friendRoutes.get("/api/friends/leaderboard", async (c) => {
  const playerId = pid(c);
  const me = await profile(c.env, playerId);
  const date = c.req.query("date") ?? today();
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.nickname, p.friend_code,
            (SELECT points FROM daily_results r WHERE r.player_id = p.id AND r.date = ?2) AS points,
            (SELECT tiers FROM daily_results r WHERE r.player_id = p.id AND r.date = ?2) AS tiers,
            (SELECT COALESCE(SUM(points), 0) FROM daily_results r WHERE r.player_id = p.id AND r.date > date(?2, '-7 days')) AS week
     FROM players p
     WHERE p.id = ?1 OR p.id IN (SELECT friend_id FROM friends WHERE player_id = ?1)`,
  )
    .bind(playerId, date)
    .all<{ id: string; nickname: string | null; friend_code: string; points: number | null; tiers: string | null; week: number }>();
  const rows = results
    .map((r) => ({
      you: r.id === playerId,
      nickname: r.nickname ?? (r.id === playerId ? "You" : "Diver"),
      friendCode: r.friend_code,
      depth: r.points === null ? null : pointsToDepth(r.points),
      zone: r.points === null ? null : zoneForDepth(pointsToDepth(r.points)).name,
      tiers: r.tiers ? (JSON.parse(r.tiers) as (number | null)[]) : null,
      weekDepth: pointsToDepth(r.week),
    }))
    .sort((a, b) => (b.depth ?? -1) - (a.depth ?? -1));
  return c.json({ date, dailyNumber: await dailyNumber(c.env, date), me, rows });
});

/** Past Dailies you can replay (unscored). */
friendRoutes.get("/api/archive", async (c) => {
  const playerId = pid(c);
  const { results } = await c.env.DB.prepare(
    `SELECT d.date,
            (SELECT points FROM daily_results r WHERE r.player_id = ? AND r.date = d.date) AS points
     FROM daily_sets d WHERE d.date < ? ORDER BY d.date DESC LIMIT 365`,
  )
    .bind(playerId, today())
    .all<{ date: string; points: number | null }>();
  const rows = [];
  for (const r of results) rows.push({ date: r.date, dailyNumber: await dailyNumber(c.env, r.date), depth: r.points === null ? null : pointsToDepth(r.points) });
  return c.json(rows);
});
