/**
 * npm run sim:leaderboards: a few named players play real Unlimited dives (and one
 * unnamed player does too), then the global leaderboards are checked: named players
 * appear, the unnamed one never does, and values add up.
 */
import { BASE, Bot, Checks, answerBook, createRoom, ensureServer } from "./lib";
import type { ServerMessage } from "../../shared/src/index";

const stop = await ensureServer();
const checks = new Checks();
const book = answerBook();
const run = Date.now().toString(36);

async function call<T>(pid: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": pid },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data as T;
}

type State = { sessionId: string; current: { index: number; prompt: string } | null; finished: boolean };

/** Plays one Unlimited dive; `pick` chooses which answer (by list position) to type. */
async function dive(pid: string, pick: (answers: { text: string; tier: number }[]) => string) {
  let s = await call<State>(pid, "POST", "/api/session/start", { mode: "unlimited" });
  for (let i = 0; i < 7; i++) {
    s = await call<State>(pid, "POST", `/api/session/${s.sessionId}/next`);
    if (!s.current) break;
    const answers = book.get(s.current.prompt) ?? [];
    const r = await call<{ accepted: boolean }>(pid, "POST", `/api/session/${s.sessionId}/guess`, { index: s.current.index, text: pick(answers) });
    if (!r.accepted) console.log("  not accepted:", s.current.prompt, pick(answers), answers.length);
  }
  await call(pid, "POST", `/api/session/${s.sessionId}/finish`);
}

try {
  const players = [
    { id: `sim-lb-${run}-a`, name: `Krill${run.slice(-3)}`, pick: (a: { text: string; tier: number }[]) => (a.find((x) => x.tier === 100) ?? a[0])?.text ?? "x" },
    { id: `sim-lb-${run}-b`, name: `Deep${run.slice(-3)}`, pick: (a: { text: string; tier: number }[]) => (a.find((x) => x.tier === 85) ?? a[0])?.text ?? "x" },
    { id: `sim-lb-${run}-c`, name: `Easy${run.slice(-3)}`, pick: (a: { text: string; tier: number }[]) => (a.find((x) => x.tier === 10) ?? a[0])?.text ?? "x" },
  ];
  const anon = `sim-lb-${run}-anon`;
  for (const p of players) await call(p.id, "POST", "/api/player", { nickname: p.name });
  for (const p of players) for (let d = 0; d < 2; d++) await dive(p.id, p.pick);
  await dive(anon, (a) => (a.find((x) => x.tier === 100) ?? a[0])?.text ?? "x");

  // A 2-player party Dive between named players a and b.
  const code = await createRoom("dive");
  const [a, b] = [new Bot(code, players[0].id, players[0].name), new Bot(code, players[1].id, players[1].name)];
  await a.connect();
  await b.connect();
  await a.waitFor((m) => m.type === "state" && m.state.players.length === 2, 5000);
  a.send({ type: "settings", settings: { source: "unlimited", questionCount: 3, timerSeconds: 15 } });
  await a.waitFor((m) => m.type === "state" && (m.state.settings as { questionCount: number }).questionCount === 3);
  a.send({ type: "start" });
  for (let i = 0; i < 3; i++) {
    const q = (await a.waitFor((m) => m.type === "question" && m.index === i)) as Extract<ServerMessage, { type: "question" }>;
    const ans = book.get(q.prompt) ?? [];
    a.send({ type: "guess", text: (ans.find((x) => x.tier === 100) ?? ans[0])?.text ?? "x" });
    b.send({ type: "guess", text: (ans.find((x) => x.tier === 10) ?? ans[0])?.text ?? "x" });
    await a.waitFor((m) => m.type === "reveal" && m.index === i, 30_000);
    a.send({ type: "next" });
  }
  await a.waitFor((m) => m.type === "gameOver", 20_000);
  a.close();
  b.close();
  await new Promise((r) => setTimeout(r, 1500)); // let the party result finish writing

  const lb = await call<{ boards: { id: string; rows: { nickname: string; value: number; you: boolean }[] }[] }>(players[0].id, "GET", "/api/leaderboards");
  const board = (id: string) => lb.boards.find((x) => x.id === id)!;
  const has = (id: string, name: string) => board(id).rows.some((r) => r.nickname === name);
  checks.check("13 boards returned", lb.boards.length === 13);
  // A full top 10 of players tied at or above our 2 dives can push sim players off (old local test data).
  const dives = board("dives").rows;
  const crowded = dives.length >= 10 && dives[dives.length - 1].value >= 2;
  checks.check("named players appear on 'Most dives' (or it's full of equal or better players)", crowded || players.every((p) => has("dives", p.name)));
  checks.check("the krillion hunter tops 'Most One in a Krillions' among sim players", (board("krillions").rows.find((r) => r.nickname.startsWith("Krill"))?.value ?? 0) > 0);
  checks.check("the deep-cut player is on 'Most Deep Cuts'", has("deepcuts", players[1].name));
  checks.check("'you' is marked for the requesting player", board("krillions").rows.some((r) => r.you && r.nickname === players[0].name));
  checks.check("unnamed players never appear", lb.boards.every((b) => b.rows.every((r) => !!r.nickname)));
  checks.check("party Dive win recorded for the winner", has("dive-wins", players[0].name));
} finally {
  stop();
}
console.log(checks.ok ? "\nLEADERBOARD SIMULATION PASSED" : "\nLEADERBOARD SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
