import { Hono } from "hono";
import type { Context } from "hono";
import { dailyNumberFor, nicknameProblem, pointsToDepth, zoneForDepth } from "@krillion/shared";
import { HttpError } from "./env";
import type { Env } from "./env";
import { today } from "./questions";

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
  return c.json({ date, dailyNumber: dailyNumberFor(date), me, rows });
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
  return c.json(results.map((r) => ({ date: r.date, dailyNumber: dailyNumberFor(r.date), depth: r.points === null ? null : pointsToDepth(r.points) })));
});
