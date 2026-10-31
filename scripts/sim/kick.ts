/**
 * npm run sim:kick: the host removing a player (and them staying out), plus
 * "Did you mean…?" before an autocorrected answer counts, in a party Dive and solo.
 */
import type { ServerMessage } from "../../shared/src/index";
import { BASE, Bot, Checks, answerBook, createRoom, ensureServer, sleep } from "./lib";

const stop = await ensureServer();
const checks = new Checks();
const book = answerBook();
const run = Date.now().toString(36);

/** A one-letter-swap typo of the first long answer (keeps the first letter, so it's one autocorrect away). */
function typoFor(prompt: string) {
  const a = (book.get(prompt) ?? []).find((x) => /^[a-z]{8,}$/i.test(x.text) && x.text[3] !== x.text[4]);
  if (!a) return null;
  const t = a.text;
  return { real: a.text, typo: t.slice(0, 3) + t[4] + t[3] + t.slice(5) };
}

try {
  const code = await createRoom("dive");
  const host = new Bot(code, `sim-kick-${run}-h`, "Host");
  const guest = new Bot(code, `sim-kick-${run}-g`, "Guest");
  const other = new Bot(code, `sim-kick-${run}-o`, "Other");
  for (const b of [host, guest, other]) await b.connect();
  await host.waitFor((m) => m.type === "state" && m.state.players.length === 3, 5000);

  const closed = new Promise<number>((resolve) => guest.ws.once("close", (c: number) => resolve(c)));
  guest.send({ type: "kick", playerId: host.playerId }); // not the host: ignored
  await sleep(300);
  checks.check("only the host can kick", (host.state?.players.length ?? 0) === 3);
  host.send({ type: "kick", playerId: guest.playerId });
  const codeClosed = await Promise.race([closed, sleep(4000).then(() => -1)]);
  checks.check("the kicked player is disconnected", codeClosed === 4003, String(codeClosed));
  await sleep(300);
  checks.check("their seat is gone", !host.state?.players.some((p) => p.id === guest.playerId));
  const again = new Bot(code, guest.playerId, "Guest");
  let refused = false;
  await again.connect().catch(() => (refused = true));
  await sleep(500);
  refused ||= again.inbox.some((m) => m.type === "error" && /removed/i.test(m.message));
  checks.check("a kicked player can't rejoin", refused);

  // Did you mean…? in a party Dive
  host.send({ type: "settings", settings: { source: "unlimited", questionCount: 3, timerSeconds: 40 } });
  await sleep(300);
  host.send({ type: "start" });
  const q = (await host.waitFor((m) => m.type === "question")) as Extract<ServerMessage, { type: "question" }>;
  const t = typoFor(q.prompt);
  if (t) {
    host.send({ type: "guess", text: t.typo });
    const g1 = (await host.waitFor((m) => m.type === "guessResult")) as Extract<ServerMessage, { type: "guessResult" }>;
    checks.check("party: an autocorrected guess asks first", !g1.accepted && g1.reason === "confirm" && g1.canonical === t.real, `${t.typo} → ${g1.canonical}`);
    host.inbox.length = 0;
    host.send({ type: "guess", text: t.typo, confirm: true });
    const g2 = (await host.waitFor((m) => m.type === "guessResult")) as Extract<ServerMessage, { type: "guessResult" }>;
    checks.check("party: saying yes accepts it", g2.accepted && g2.canonical === t.real);
  } else checks.check("party: found a long answer to misspell", false, q.prompt);
  [host, other, again].forEach((b) => b.close());

  // Did you mean…? solo (Unlimited)
  const pid = `sim-kick-${run}-solo`;
  const call = async <T>(method: string, path: string, body?: unknown) =>
    (await (await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", "X-Player-Id": pid }, body: body ? JSON.stringify(body) : undefined })).json()) as T;
  let s = await call<{ sessionId: string; current: { index: number; prompt: string } | null }>("POST", "/api/session/start", { mode: "unlimited" });
  for (let i = 0; i < 7; i++) {
    s = await call("POST", `/api/session/${s.sessionId}/next`);
    if (!s.current) break;
    const ty = typoFor(s.current.prompt);
    if (!ty) {
      await call("POST", `/api/session/${s.sessionId}/guess`, { index: s.current.index, text: (book.get(s.current.prompt) ?? [])[0]?.text });
      continue;
    }
    const r1 = await call<{ accepted: boolean; reason: string | null; canonical: string | null }>("POST", `/api/session/${s.sessionId}/guess`, { index: s.current.index, text: ty.typo });
    checks.check("solo: an autocorrected guess asks first", !r1.accepted && r1.reason === "confirm" && r1.canonical === ty.real, `${ty.typo} → ${r1.canonical}`);
    const r2 = await call<{ accepted: boolean }>("POST", `/api/session/${s.sessionId}/guess`, { index: s.current.index, text: ty.typo, confirm: true });
    checks.check("solo: saying yes accepts it", r2.accepted);
    break;
  }
} finally {
  stop();
}
console.log(checks.ok ? "\nKICK SIMULATION PASSED" : "\nKICK SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
