import { Hono } from "hono";
import { HttpError } from "./env";
import type { Env } from "./env";

/**
 * The suggestion box. Players send fixes and ideas; the weekly task downloads
 * open ones (admin), acts on answer fixes, summarizes the rest for the owner,
 * then marks them reviewed.
 */

type AppEnv = { Bindings: Env };
export const suggestionRoutes = new Hono<AppEnv>();

const KINDS = ["answer", "bug", "idea", "other"] as const;
const MAX_LENGTH = 1000;
const MAX_PER_DAY = 10;

let ready = false;
async function ensureTable(env: Env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS suggestions (
       id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT, nickname TEXT, kind TEXT NOT NULL,
       text TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open')`,
  ).run();
  ready = true;
}

suggestionRoutes.post("/api/suggestions", async (c) => {
  const playerId = c.req.header("X-Player-Id") ?? "";
  if (!/^[\w-]{8,64}$/.test(playerId)) throw new HttpError(400, "Missing or invalid player id");
  const body = await c.req.json<{ kind?: string; text?: string }>().catch(() => ({}) as { kind?: string; text?: string });
  const text = String(body.text ?? "").trim().slice(0, MAX_LENGTH);
  const kind = (KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) : "other";
  if (text.length < 3) throw new HttpError(400, "Write a little more so we know what to fix");
  await ensureTable(c.env);
  const now = Date.now();
  const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE player_id = ? AND created_at > ?")
    .bind(playerId, now - 86_400_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_PER_DAY) throw new HttpError(429, "Thanks! That's plenty for today. Send more tomorrow.");
  const who = await c.env.DB.prepare("SELECT nickname FROM players WHERE id = ?").bind(playerId).first<{ nickname: string | null }>();
  await c.env.DB.prepare("INSERT INTO suggestions (player_id, nickname, kind, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(playerId, who?.nickname ?? null, kind, text, now)
    .run();
  return c.json({ ok: true });
});

/** Admin: open suggestions as plain text for the weekly task. */
export async function suggestionsExport(env: Env): Promise<{ text: string; ids: number[] }> {
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    "SELECT id, nickname, kind, text, created_at FROM suggestions WHERE status = 'open' ORDER BY kind, created_at LIMIT 500",
  ).all<{ id: number; nickname: string | null; kind: string; text: string; created_at: number }>();
  const lines = [
    "PLAYER SUGGESTIONS",
    "Kinds: answer = a question or answer fix, bug = something broken, idea = a feature or game idea, other.",
    "Act on answer fixes with FIXES blocks (same rules as the learning loop). Summarize bugs and ideas for the owner.",
    "",
  ];
  if (!results.length) lines.push("(No new suggestions.)");
  for (const r of results) {
    lines.push(`- #${r.id} [${r.kind}] ${new Date(r.created_at).toISOString().slice(0, 10)} ${r.nickname ?? "anonymous"}: ${r.text.replace(/\s+/g, " ")}`);
  }
  return { text: lines.join("\n") + "\n", ids: results.map((r) => r.id) };
}

export async function markSuggestionsReviewed(env: Env, ids: number[]): Promise<number> {
  await ensureTable(env);
  if (!ids.length) return 0;
  const res = await env.DB.prepare(`UPDATE suggestions SET status = 'reviewed' WHERE status = 'open' AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .run();
  return res.meta.changes ?? 0;
}
