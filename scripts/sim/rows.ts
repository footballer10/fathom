/**
 * npm run sim:rows: plays through the site as one new player and prints how many
 * D1 rows each request reads and writes (local wrangler dev reports them in
 * X-D1-Rows-* headers). Use it to check nothing creeps toward the free-tier
 * limits (5M rows read, 100k rows written per day).
 */
import { BASE, answerBook, ensureServer } from "./lib";

const stop = await ensureServer();
const book = answerBook();
const pid = `sim-rows-${Date.now().toString(36)}`;
const lines: { label: string; read: number; written: number }[] = [];

async function call<T>(label: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": pid },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const read = Number(res.headers.get("X-D1-Rows-Read") ?? 0);
  const written = Number(res.headers.get("X-D1-Rows-Written") ?? 0);
  const prev = lines.find((l) => l.label === label);
  if (prev) {
    prev.read = Math.max(prev.read, read);
    prev.written = Math.max(prev.written, written);
  } else lines.push({ label, read, written });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 410) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data as T;
}

type State = { sessionId: string; current: { index: number; prompt: string } | null };
const answer = (prompt: string) => book.get(prompt)?.[3]?.text ?? "zzz";

async function dive(mode: "daily" | "unlimited") {
  let s = await call<State>(`${mode}: start`, "POST", "/api/session/start", { mode });
  for (let i = 0; i < 7; i++) {
    s = await call<State>(`${mode}: next`, "POST", `/api/session/${s.sessionId}/next`);
    if (!s.current) break;
    await call(`${mode}: wrong guess`, "POST", `/api/session/${s.sessionId}/guess`, { index: s.current.index, text: "qqqqzz" });
    await call(`${mode}: right guess`, "POST", `/api/session/${s.sessionId}/guess`, { index: s.current.index, text: answer(s.current.prompt) });
  }
  return call<{ date?: string }>(`${mode}: finish`, "POST", `/api/session/${s.sessionId}/finish`);
}

try {
  await call("account: sign up", "POST", "/api/account/create", { username: `Rows${pid.slice(-4)}`, password: "simpass1" });
  await call("home: player", "GET", "/api/player");
  await call("home: daily", "GET", "/api/daily");
  await call("home: categories", "GET", "/api/categories");
  const fin = await dive("daily");
  await call("daily: top 10", "GET", `/api/daily/top?date=${fin.date ?? new Date().toISOString().slice(0, 10)}`);
  await dive("unlimited");
  await call("stats: me", "GET", "/api/stats/me");
  await call("leaderboards (uncached)", "GET", "/api/leaderboards");
  await call("friends: leaderboard", "GET", "/api/friends/leaderboard");
  await call("friends: requests", "GET", "/api/friends/requests");
  await call("archive", "GET", "/api/archive");
  const run = await call<{ runId: string }>("quick: start", "POST", "/api/practice/start", { mode: "sprint" });
  for (let i = 0; i < 5; i++) {
    const q = await call<{ id: string; prompt: string }>("quick: question", "POST", "/api/practice/question", { mode: "sprint", runId: run.runId });
    await call("quick: guess", "POST", "/api/practice/guess", { runId: run.runId, id: q.id, text: answer(q.prompt) });
  }
  await call("quick: finish", "POST", "/api/practice/finish", { runId: run.runId });
  await call("roulette: question", "POST", "/api/practice/question", { mode: "roulette" });
  await call("abyss: view", "GET", "/api/abyss");
  await call("rooms: create", "POST", "/api/rooms", { kind: "dive" });

  const w = Math.max(...lines.map((l) => l.label.length));
  console.log(`${"request".padEnd(w)}  rows read  rows written`);
  for (const l of lines) console.log(`${l.label.padEnd(w)}  ${String(l.read).padStart(9)}  ${String(l.written).padStart(12)}`);
} finally {
  stop();
}
