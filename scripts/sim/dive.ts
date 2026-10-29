/**
 * npm run sim:dive: six simulated players play a 3-question Party Dive on the
 * local server, exercising: synced questions, lock-ins, wrong guesses, a
 * timeout, the "unique answers" half-points rule, a reconnect, host migration,
 * reveals with leaderboards, and the final results.
 */
import type { ServerMessage } from "../../shared/src/index";
import { Bot, Checks, answerBook, createRoom, ensureServer, sleep } from "./lib";

type QuestionMsg = Extract<ServerMessage, { type: "question" }>;
type RevealMsg = Extract<ServerMessage, { type: "reveal" }>;
type OverMsg = Extract<ServerMessage, { type: "gameOver" }>;

const stop = await ensureServer();
const checks = new Checks();
const book = answerBook();
const run = Date.now().toString(36);

try {
  const code = await createRoom("dive");
  console.log(`Room ${code}`);
  const bots = Array.from({ length: 6 }, (_, i) => new Bot(code, `sim-dive-${run}-${i}`, `Diver ${i + 1}`));
  for (const b of bots) await b.connect();
  const [host, b1, b2, b3, b4, b5] = bots;
  const full = await host.waitFor((m) => m.type === "state" && m.state.players.length === 6, 5000).catch(() => null);
  checks.check("all six players joined", !!full);
  checks.check("first joiner is host", host.state?.hostId === host.playerId);

  host.send({ type: "settings", settings: { source: "unlimited", questionCount: 3, timerSeconds: 15, uniqueAnswers: true } });
  await host.waitFor((m) => m.type === "state" && (m.state.settings as { questionCount: number }).questionCount === 3);
  host.send({ type: "start" });

  const reveals: RevealMsg[] = [];
  let hostMigrated = false;

  for (let q = 0; q < 3; q++) {
    const question = (await b1.waitFor((m) => m.type === "question" && m.index === q)) as QuestionMsg;
    const answers = book.get(question.prompt) ?? [];
    checks.check(`Q${q + 1} has a known prompt: "${question.prompt}"`, answers.length > 0);
    const plankton = answers.find((a) => a.tier === 10)?.text ?? answers[0]?.text ?? "x";
    const rare = answers.find((a) => a.tier === 60)?.text ?? answers[1]?.text ?? "y";
    const deep = answers.find((a) => a.tier === 85)?.text ?? answers[2]?.text ?? "z";

    if (q === 2) {
      // Host drops mid-game: the oldest connected player should take over.
      host.close();
      await sleep(600);
      const st = (await b1.waitFor((m) => m.type === "state" && m.state.hostId === b1.playerId, 10_000).catch(() => null)) as
        | Extract<ServerMessage, { type: "state" }>
        | null;
      hostMigrated = !!st;
    }

    // Players 0 and 1 give the SAME answer (unique-answers rule → half points each).
    if (q !== 2) host.send({ type: "guess", text: plankton });
    b1.send({ type: "guess", text: plankton });
    // Player 2: a wrong guess first (−2s), then a Rare answer.
    b2.inbox = [];
    b2.send({ type: "guess", text: "definitely not a real answer" });
    const wrong = await b2.waitFor((m) => m.type === "guessResult" && !m.accepted);
    checks.check(`Q${q + 1} wrong guess rejected with a −2s deadline`, wrong.type === "guessResult" && wrong.endsAt === question.endsAt - 2000);
    b2.send({ type: "guess", text: rare });
    // Player 3 sits out question 1 (times out), answers later ones.
    if (q > 0) b3.send({ type: "guess", text: deep });
    b4.send({ type: "guess", text: deep });
    // Player 5 drops during question 2 and reconnects to the same seat.
    if (q === 1) {
      b5.close();
      await sleep(800);
      await b5.connect();
      checks.check("reconnected player kept their seat", b5.state?.players.filter((p) => p.id === b5.playerId).length === 1);
    }
    b5.send({ type: "guess", text: answers.find((a) => a.tier === 30)?.text ?? plankton });

    const reveal = (await b1.waitFor((m) => m.type === "reveal" && m.index === q, 30_000)) as RevealMsg;
    reveals.push(reveal);
    const sharedRows = reveal.perPlayer.filter((r) => r.shared);
    const lb = reveal.leaderboard;
    checks.check(`Q${q + 1} reveal has a row per player`, reveal.perPlayer.length === 6);
    checks.check(`Q${q + 1} leaderboard is sorted`, lb.every((r, i) => i === 0 || lb[i - 1].score >= r.score));
    checks.check(`Q${q + 1} full answer list included`, reveal.answers.length >= 50);
    if (q < 2) {
      const p0 = reveal.perPlayer.find((r) => r.playerId === host.playerId)!;
      checks.check(`Q${q + 1} same answer → both marked shared, half points`, sharedRows.length >= 2 && p0.shared && p0.points === 5, `points ${p0?.points}`);
    }
    if (q === 0) {
      const p3 = reveal.perPlayer.find((r) => r.playerId === b3.playerId)!;
      checks.check("timed-out player scores 0", p3.points === 0 && p3.canonical === null);
    }
    if (q === 2) {
      host.inbox = [];
      await host.connect(); // host comes back as a regular player
    }
    if (q < 2) b1.send({ type: "next" }); // only the host can skip; b1 isn't host yet, so this is ignored
  }

  checks.check("host migrated to the oldest connected player", hostMigrated);
  const over = (await b1.waitFor((m) => m.type === "gameOver", 30_000)) as OverMsg;
  const r = over.results;
  checks.check("final results for every player", r.length === 6);
  checks.check(
    "results sorted by score, ties by less time used",
    r.every((x, i) => i === 0 || r[i - 1].score > x.score || (r[i - 1].score === x.score && r[i - 1].timeUsedMs <= x.timeUsedMs)),
  );
  checks.check("depth trail for the finale race", r.every((x) => x.depthTrail.length === 3));
  checks.check("best answer of the game reported", !!over.bestAnswer);
  console.log("\nFinal standings:");
  for (const x of r) console.log(`  ${x.rank}. ${x.nickname.padEnd(9)} ${String(x.depth).padStart(5)} m  (${(x.timeUsedMs / 1000).toFixed(1)}s used)`);
  for (const b of bots) b.close();
} catch (err) {
  checks.check("simulation ran to completion", false, (err as Error).message);
} finally {
  stop();
}

console.log(checks.ok ? "\nDIVE SIMULATION PASSED" : "\nDIVE SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
