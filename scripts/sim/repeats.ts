/**
 * npm run sim:repeats: the same two players play several Dive games in a row;
 * no question should come up twice until they've seen most of the pool.
 */
import { Bot, Checks, answerBook, createRoom, ensureServer } from "./lib";
import type { ServerMessage } from "../../shared/src/index";

const stop = await ensureServer();
const checks = new Checks();
const run = Date.now().toString(36);
const ids = [`sim-rep-${run}-a`, `sim-rep-${run}-b`];
const seen: string[] = [];
const book = answerBook();

try {
  for (let game = 0; game < 4; game++) {
    const code = await createRoom("dive");
    const [a, b] = ids.map((id, i) => new Bot(code, id, `Repeat ${i + 1}`));
    await a.connect();
    await b.connect();
    await a.waitFor((m) => m.type === "state" && m.state.players.length === 2, 5000);
    a.send({ type: "settings", settings: { source: "unlimited", questionCount: 5, timerSeconds: 15, uniqueAnswers: false } });
    await a.waitFor((m) => m.type === "state" && (m.state.settings as { questionCount: number }).questionCount === 5);
    a.send({ type: "start" });
    for (let q = 0; q < 5; q++) {
      const msg = (await a.waitFor((m) => m.type === "question" && m.index === q)) as Extract<ServerMessage, { type: "question" }>;
      seen.push(msg.prompt);
      // Both lock in an answer so the question ends right away.
      const answers = book.get(msg.prompt) ?? [];
      a.send({ type: "guess", text: answers[0]?.text ?? "x" });
      b.send({ type: "guess", text: answers[1]?.text ?? answers[0]?.text ?? "x" });
      await a.waitFor((m) => m.type === "reveal" && m.index === q, 20_000).catch(() => null);
      a.send({ type: "next" });
    }
    a.close();
    b.close();
  }
  checks.check(`20 questions over 4 games, no repeats (${new Set(seen).size} unique)`, new Set(seen).size === seen.length);
} finally {
  stop();
}
console.log(checks.ok ? "\nREPEAT SIMULATION PASSED" : "\nREPEAT SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
