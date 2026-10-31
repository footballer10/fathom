/**
 * npm run sim:social: friend requests from the leaderboards and the suggestion
 * box, against the local server.
 */
import { BASE, Checks, ensureServer } from "./lib";
import { adminFetch } from "../lib/admin-client";

const stop = await ensureServer();
const checks = new Checks();
const run = Date.now().toString(36);

async function call<T>(pid: string, method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": pid },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, data: (await res.json()) as T };
}

try {
  const a = { id: `sim-soc-${run}-a`, name: `Ann${run.slice(-3)}` };
  const b = { id: `sim-soc-${run}-b`, name: `Ben${run.slice(-3)}` };
  const pa = (await call<{ friendCode: string }>(a.id, "POST", "/api/player", { nickname: a.name })).data;
  const pb = (await call<{ friendCode: string }>(b.id, "POST", "/api/player", { nickname: b.name })).data;

  const sent = await call<{ status: string }>(a.id, "POST", "/api/friends/requests", { code: pb.friendCode });
  checks.check("request sent", sent.ok && sent.data.status === "sent");
  const self = await call(a.id, "POST", "/api/friends/requests", { code: pa.friendCode });
  checks.check("can't friend yourself", !self.ok);
  const inbox = await call<{ requests: { code: string; nickname: string }[] }>(b.id, "GET", "/api/friends/requests");
  checks.check("recipient sees the request with the sender's name", inbox.data.requests.some((r) => r.code === pa.friendCode && r.nickname === a.name));
  const acc = await call(b.id, "POST", `/api/friends/requests/${pa.friendCode}/accept`);
  checks.check("accept works", acc.ok);
  const after = await call<{ requests: unknown[] }>(b.id, "GET", "/api/friends/requests");
  checks.check("request gone after accepting", after.data.requests.length === 0);
  const board = await call<{ rows: { nickname: string }[] }>(a.id, "GET", "/api/friends/leaderboard");
  checks.check("both are on each other's friends board", board.data.rows.some((r) => r.nickname === b.name));
  const again = await call<{ status: string }>(a.id, "POST", "/api/friends/requests", { code: pb.friendCode });
  checks.check("asking a friend again just says friends", again.data.status === "friends");

  // Mutual: C asks A, then A asks C → instantly friends.
  const c = { id: `sim-soc-${run}-c`, name: `Cal${run.slice(-3)}` };
  const pc = (await call<{ friendCode: string }>(c.id, "POST", "/api/player", { nickname: c.name })).data;
  await call(c.id, "POST", "/api/friends/requests", { code: pa.friendCode });
  const mutual = await call<{ status: string }>(a.id, "POST", "/api/friends/requests", { code: pc.friendCode });
  checks.check("asking someone who already asked you makes you friends", mutual.data.status === "friends");

  const lb = await call<{ boards: { rows: { code: string | null; friend: string | null }[] }[] }>(a.id, "GET", "/api/leaderboards");
  checks.check("leaderboard rows carry friend codes", lb.ok && lb.data.boards.every((bd) => bd.rows.every((r) => "code" in r && "friend" in r)));

  const tag = `sim suggestion ${run}`;
  const sug = await call(a.id, "POST", "/api/suggestions", { kind: "answer", text: `${tag}: "fork" should be Plankton` });
  checks.check("suggestion accepted", sug.ok);
  const tooShort = await call(a.id, "POST", "/api/suggestions", { kind: "idea", text: "x" });
  checks.check("empty suggestion rejected", !tooShort.ok);
  const exp = await adminFetch<{ text: string; ids: number[] }>("/api/admin/suggestions", {}, ["--local"]);
  checks.check("admin export includes it with the player's name", exp.text.includes(tag) && exp.text.includes(a.name));
  const done = await adminFetch<{ reviewed: number }>("/api/admin/suggestions/reviewed", { method: "POST", body: { ids: exp.ids } }, ["--local"]);
  const exp2 = await adminFetch<{ text: string }>("/api/admin/suggestions", {}, ["--local"]);
  checks.check("marking reviewed removes it from the next export", done.reviewed >= 1 && !exp2.text.includes(tag));
  const rev = await adminFetch<{ reports: number; rejected: number }>("/api/admin/review/done", { method: "POST", body: { before: Date.now() } }, ["--local"]);
  checks.check("review:done endpoint works", typeof rev.reports === "number");
} finally {
  stop();
}
console.log(checks.ok ? "\nSOCIAL SIMULATION PASSED" : "\nSOCIAL SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
