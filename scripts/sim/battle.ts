/**
 * npm run sim:battle: six simulated players play Party Battle on the local
 * server, exercising: turns, live typing, the turn timer with tier bonuses,
 * "Already taken" answers, lives and elimination, prompt rotation with
 * speed-up, spectator guesses, and the last-player-standing finish.
 */
import type { ServerMessage } from "../../shared/src/index";
import { Bot, Checks, answerBook, createRoom, ensureServer, sleep } from "./lib";

type TurnMsg = Extract<ServerMessage, { type: "turn" }>;
type OverMsg = Extract<ServerMessage, { type: "gameOver" }>;

const stop = await ensureServer();
const checks = new Checks();
const book = answerBook();
const run = Date.now().toString(36);

// How many turns each bot answers correctly before it stops (and, with 1 life, is out).
const QUOTA = [3, 1, 2, 0, 2, 4];
const WINNER = 5;
const BASE = 6;

try {
  const code = await createRoom("battle");
  console.log(`Room ${code}`);
  const bots = Array.from({ length: 6 }, (_, i) => new Bot(code, `sim-battle-${run}-${i}`, `Player ${i + 1}`));
  for (const b of bots) await b.connect();
  const host = bots[0];
  await host.waitFor((m) => m.type === "state" && m.state.players.length === 6, 5000);

  host.send({ type: "settings", settings: { source: "unlimited", lives: 1, baseSeconds: BASE, failedTurnsToRotate: 2, speedUp: true, bonusScale: "normal" } });
  await host.waitFor((m) => m.type === "state" && (m.state.settings as { lives: number }).lives === 1);

  const used = new Set<string>();
  let prompt = "";
  const turnsTaken = new Map<string, number>();
  const lastAccepted = new Map<string, boolean>();
  let sawTyping = false;
  let sawTaken = false;
  let sawBonus = false;
  let firstTurnBaseOnly = true;
  let rotations = 0;
  let baseAfterRotate = BASE;
  let spectatorDone = false;
  let sawSpectatorGuess = false;
  const eliminated = new Set<string>();

  const observer = bots[1];
  observer.on((m) => {
    if (m.type === "typing" && m.playerId !== observer.playerId) sawTyping = true;
    if (m.type === "taken") sawTaken = true;
    if (m.type === "turnResult") used.add(m.canonical.toLowerCase());
    if (m.type === "eliminated") eliminated.add(m.playerId);
    if (m.type === "spectatorGuess") sawSpectatorGuess = true;
    if (m.type === "rotate") {
      rotations++;
      baseAfterRotate = m.baseSeconds;
      used.clear();
      prompt = m.prompt;
    }
  });

  // Each bot plays its own turns.
  for (const [i, bot] of bots.entries()) {
    bot.on(async (m) => {
      if (m.type !== "turn" || m.playerId !== bot.playerId) return;
      const turn = m as TurnMsg;
      prompt = turn.prompt;
      const n = turnsTaken.get(bot.playerId) ?? 0;
      turnsTaken.set(bot.playerId, n + 1);
      const prev = lastAccepted.get(bot.playerId);
      if (prev === true && turn.seconds > BASE) sawBonus = true;
      if (n === 0 && rotations === 0 && turn.seconds !== BASE) firstTurnBaseOnly = false;

      if (n >= QUOTA[i]) {
        lastAccepted.set(bot.playerId, false);
        return; // sit this turn out → time runs out → lose the life
      }
      const answers = book.get(turn.prompt) ?? [];
      const pick = answers.find((a) => !used.has(a.text.toLowerCase()));
      if (!pick) return;
      // Live typing, about 8 updates a second.
      for (let k = 1; k <= Math.min(pick.text.length, 4); k++) {
        bot.send({ type: "typing", text: pick.text.slice(0, k) });
        await sleep(130);
      }
      // Player 5's first turn: try an answer someone already used.
      if (i === 4 && n === 0 && used.size) {
        const taken = answers.find((a) => used.has(a.text.toLowerCase()));
        if (taken) {
          bot.send({ type: "guess", text: taken.text });
          await sleep(300);
        }
      }
      bot.send({ type: "guess", text: pick.text });
      lastAccepted.set(bot.playerId, true);
    });
  }

  // An eliminated player can still guess for fun.
  bots[3].on((m) => {
    if (m.type === "eliminated" && m.playerId === bots[3].playerId && !spectatorDone) {
      spectatorDone = true;
      setTimeout(() => {
        const answers = book.get(prompt) ?? [];
        bots[3].send({ type: "guess", text: answers[answers.length - 1]?.text ?? "anything" });
      }, 400);
    }
  });

  host.send({ type: "start" });
  const over = (await observer.waitFor((m) => m.type === "gameOver", 180_000)) as OverMsg;

  checks.check("live typing reached other players", sawTyping);
  checks.check('"Already taken" was announced', sawTaken);
  checks.check("turn bonus applied after an accepted answer", sawBonus);
  checks.check("a player's first turn gets the base time only", firstTurnBaseOnly);
  checks.check("prompt rotated at least once", rotations >= 1, `${rotations} rotation(s)`);
  checks.check("speed-up lowered the base time", baseAfterRotate < BASE, `base now ${baseAfterRotate}s`);
  checks.check("eliminated players became spectators who can still guess", sawSpectatorGuess);
  checks.check("five players were eliminated", eliminated.size === 5, `${eliminated.size}`);
  checks.check("last player standing wins", over.results[0]?.playerId === bots[WINNER].playerId, over.results[0]?.nickname);
  checks.check("best answer of the game reported", !!over.bestAnswer, over.bestAnswer ? `${over.bestAnswer.canonical} by ${over.bestAnswer.nickname}` : "");
  console.log("\nFinal standings:");
  for (const x of over.results) console.log(`  ${x.rank}. ${x.nickname}  ${x.score} pts`);
  for (const b of bots) b.close();
} catch (err) {
  checks.check("simulation ran to completion", false, (err as Error).message);
} finally {
  stop();
}

console.log(checks.ok ? "\nBATTLE SIMULATION PASSED" : "\nBATTLE SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
