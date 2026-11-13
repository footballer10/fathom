import { HttpError } from "./env";
import type { Env } from "./env";
import { clearLeaderboardCache } from "./leaderboards";
import { ensureRewards } from "./rewards";
import { ensureSchema } from "./schema";

/**
 * Banned players. A ban deletes the player's account (so its username and
 * password stop working), takes their name off every leaderboard, wipes their
 * pearls and items, and blocks their player id from the game. The next time
 * they open the site, or try to sign in to the deleted account, they're told
 * they were banned (with the reason, if one was given).
 *
 * The list of banned ids is small, so each server instance keeps it in memory
 * and re-reads it once a minute: checking a request costs no database reads.
 */

export const BANNED_CODE = "banned";

interface BanRow {
  player_id: string;
  username_key: string | null;
  reason: string;
  banned_at: number;
}

let ready = false;
async function ensureBans(env: Env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS bans (
         player_id TEXT PRIMARY KEY, username_key TEXT, nickname TEXT, reason TEXT NOT NULL DEFAULT '', banned_at INTEGER NOT NULL)`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_bans_username ON bans(username_key)"),
  ]);
  ready = true;
}

let cache: { at: number; byId: Map<string, BanRow>; byName: Map<string, BanRow> } | null = null;

async function bans(env: Env, now = Date.now()) {
  if (cache && now - cache.at < 60_000) return cache;
  await ensureBans(env);
  const { results } = await env.DB.prepare("SELECT player_id, username_key, reason, banned_at FROM bans").all<BanRow>();
  cache = {
    at: now,
    byId: new Map(results.map((r) => [r.player_id, r])),
    byName: new Map(results.filter((r) => r.username_key).map((r) => [r.username_key!, r])),
  };
  return cache;
}

export function bannedMessage(reason: string) {
  return `This player has been banned from Fathom${reason ? `: ${reason}` : "."}`;
}

/** Throws the "you're banned" error if this player id is banned. */
export async function assertNotBanned(env: Env, playerId: string | undefined | null) {
  if (!playerId) return;
  const b = (await bans(env).catch(() => null))?.byId.get(playerId);
  if (b) throw new HttpError(403, bannedMessage(b.reason), BANNED_CODE);
}

/** Throws the "you're banned" error if this (deleted) account username was banned. */
export async function assertUsernameNotBanned(env: Env, username: string) {
  const b = (await bans(env).catch(() => null))?.byName.get(username.trim().toLowerCase());
  if (b) throw new HttpError(403, bannedMessage(b.reason), BANNED_CODE);
}

/** Ban a player: delete their account, take them off the leaderboards, wipe pearls and items. */
export async function banPlayer(env: Env, playerId: string, reason: string, now: number) {
  await ensureBans(env);
  await ensureSchema(env);
  await ensureRewards(env);
  const db = env.DB;
  const p = await db.prepare("SELECT id, nickname FROM players WHERE id = ?").bind(playerId).first<{ id: string; nickname: string | null }>();
  if (!p) throw new HttpError(404, "No such player");
  const acct = await db.prepare("SELECT username, username_key FROM accounts WHERE player_id = ?").bind(playerId).first<{ username: string; username_key: string }>().catch(() => null);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO bans (player_id, username_key, nickname, reason, banned_at) VALUES (?, ?, ?, ?, ?)").bind(
      playerId,
      acct?.username_key ?? null,
      p.nickname,
      reason.slice(0, 200),
      now,
    ),
    // Account gone: the username and password no longer sign in.
    db.prepare("DELETE FROM accounts WHERE player_id = ?").bind(playerId),
    // No name means no leaderboards and no Daily top 10.
    db.prepare("UPDATE players SET nickname = NULL WHERE id = ?").bind(playerId),
    db.prepare("DELETE FROM lb_stats WHERE player_id = ?").bind(playerId),
    db.prepare("DELETE FROM wallet WHERE player_id = ?").bind(playerId),
  ]);
  cache = null;
  await clearLeaderboardCache(env);
  return { username: acct?.username ?? null, nickname: p.nickname };
}

export async function listBans(env: Env) {
  await ensureBans(env);
  const { results } = await env.DB.prepare("SELECT player_id, username_key, nickname, reason, banned_at FROM bans ORDER BY banned_at DESC LIMIT 200").all();
  return results;
}

/** Lift a ban (the deleted account and wiped pearls don't come back). */
export async function unbanPlayer(env: Env, playerId: string) {
  await ensureBans(env);
  await env.DB.prepare("DELETE FROM bans WHERE player_id = ?").bind(playerId).run();
  cache = null;
}
