import { Hono } from "hono";
import type { Context } from "hono";
import { HttpError } from "./env";
import type { Env } from "./env";

/**
 * Optional accounts: a username and password that point at a player.
 *
 * Every browser starts as a guest with a random player id. Creating an account
 * attaches a username and password to that player, so everything already played
 * on this device belongs to the account. Signing in on another device hands that
 * device the account's player id (it replaces the device's guest player, whose
 * progress stays behind). Signing out just goes back to a fresh guest.
 *
 * Passwords are never stored: only a salted PBKDF2-SHA256 hash. 20,000 rounds
 * keeps each sign-in at about 5 ms of CPU (inside the free plan's limit), and a
 * lockout after repeated wrong passwords stops anyone guessing online.
 */

type AppEnv = { Bindings: Env };
export const accountRoutes = new Hono<AppEnv>();

const ITERATIONS = 20_000;
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60_000;

function pid(c: Context<AppEnv>): string {
  const id = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, "Missing or invalid player id");
  return id;
}

let ready = false;
async function ensureAccounts(env: Env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS accounts (
       username_key TEXT PRIMARY KEY, username TEXT NOT NULL, player_id TEXT NOT NULL UNIQUE,
       salt TEXT NOT NULL, hash TEXT NOT NULL, iterations INTEGER NOT NULL,
       failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  ).run();
  ready = true;
}

export function usernameProblem(name: string): string | null {
  const n = name.trim();
  if (n.length < 3) return "Usernames need at least 3 characters";
  if (n.length > 20) return "Usernames can be at most 20 characters";
  if (!/^[A-Za-z0-9_.-]+$/.test(n)) return "Use only letters, numbers, dots, dashes and underscores";
  return null;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 6) return "Passwords need at least 6 characters";
  if (pw.length > 200) return "That password is too long";
  return null;
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));

async function hashPassword(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** Compare without leaking how many characters matched. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type AccountRow = { username_key: string; username: string; player_id: string; salt: string; hash: string; iterations: number; failures: number; locked_until: number };

/** Who this device is signed in as (null for a guest). */
accountRoutes.get("/api/account", async (c) => {
  const playerId = pid(c);
  await ensureAccounts(c.env);
  const row = await c.env.DB.prepare("SELECT username FROM accounts WHERE player_id = ?").bind(playerId).first<{ username: string }>();
  return c.json({ username: row?.username ?? null });
});

/** Turn this device's player into an account. Everything played here so far comes with it. */
accountRoutes.post("/api/account/create", async (c) => {
  const playerId = pid(c);
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}) as { username?: string; password?: string });
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const problem = usernameProblem(username) ?? passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  await ensureAccounts(c.env);
  const existing = await c.env.DB.prepare("SELECT username FROM accounts WHERE player_id = ?").bind(playerId).first<{ username: string }>();
  if (existing) throw new HttpError(409, `This device is already signed in as ${existing.username}`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt, ITERATIONS);
  const now = Date.now();
  await c.env.DB.prepare("INSERT OR IGNORE INTO players (id, created_at) VALUES (?, ?)").bind(playerId, now).run();
  const res = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO accounts (username_key, username, player_id, salt, hash, iterations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(username.toLowerCase(), username, playerId, hex(salt), hash, ITERATIONS, now)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "That username is taken. Try another one.");
  return c.json({ username });
});

/** Sign in on this device: returns the account's player id, which the device then uses. */
accountRoutes.post("/api/account/login", async (c) => {
  pid(c);
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}) as { username?: string; password?: string });
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) throw new HttpError(400, "Enter your username and password");
  await ensureAccounts(c.env);
  const row = await c.env.DB.prepare("SELECT * FROM accounts WHERE username_key = ?").bind(username.toLowerCase()).first<AccountRow>();
  const wrong = new HttpError(401, "Wrong username or password");
  if (!row) {
    // Spend the same time as a real check, so you can't tell which usernames exist.
    await hashPassword(password, new Uint8Array(16), ITERATIONS);
    throw wrong;
  }
  const now = Date.now();
  if (row.locked_until > now) {
    const mins = Math.ceil((row.locked_until - now) / 60_000);
    throw new HttpError(429, `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  const ok = sameHex(await hashPassword(password, unhex(row.salt), row.iterations), row.hash);
  if (!ok) {
    const failures = row.failures + 1;
    const lock = failures >= MAX_FAILURES;
    await c.env.DB.prepare("UPDATE accounts SET failures = ?, locked_until = ? WHERE username_key = ?")
      .bind(lock ? 0 : failures, lock ? now + LOCK_MS : 0, row.username_key)
      .run();
    throw lock ? new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.") : wrong;
  }
  if (row.failures) await c.env.DB.prepare("UPDATE accounts SET failures = 0 WHERE username_key = ?").bind(row.username_key).run();
  const p = await c.env.DB.prepare("SELECT nickname FROM players WHERE id = ?").bind(row.player_id).first<{ nickname: string | null }>();
  return c.json({ username: row.username, playerId: row.player_id, nickname: p?.nickname ?? null });
});

/** Change the password (you must know the current one). */
accountRoutes.post("/api/account/password", async (c) => {
  const playerId = pid(c);
  const body = await c.req.json<{ current?: string; next?: string }>().catch(() => ({}) as { current?: string; next?: string });
  const problem = passwordProblem(String(body.next ?? ""));
  if (problem) throw new HttpError(400, problem);
  await ensureAccounts(c.env);
  const row = await c.env.DB.prepare("SELECT * FROM accounts WHERE player_id = ?").bind(playerId).first<AccountRow>();
  if (!row) throw new HttpError(404, "This device isn't signed in");
  if (!sameHex(await hashPassword(String(body.current ?? ""), unhex(row.salt), row.iterations), row.hash)) throw new HttpError(401, "Your current password is wrong");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await c.env.DB.prepare("UPDATE accounts SET salt = ?, hash = ?, iterations = ?, failures = 0, locked_until = 0 WHERE username_key = ?")
    .bind(hex(salt), await hashPassword(String(body.next), salt, ITERATIONS), ITERATIONS, row.username_key)
    .run();
  return c.json({ ok: true });
});
