/**
 * npm run sim:variants: the party variants on the local server.
 * Co-op Dive, Shark Tank, Bluff (Dive) and Hot Potato, Relay (Battle).
 */
import type { ServerMessage } from "../../shared/src/index";
import { Bot, Checks, answerBook, createRoom, ensureServer, sleep } from "./lib";

type State = Extract<ServerMessage, { type: "state" }>["state"];
const stop = await ensureServer();
const checks = new Checks();
const book = answerBook();
const run = Date.now().toString(36);
const pick = (prompt: string, tier: number, avoid: string[] = []) => {
  const a = (book.get(prompt) ?? []).filter((x) => !avoid.includes(x.text));
  return (a.find((x) => x.tier === tier) ?? a[0])?.text ?? "nope";
};

async function room(kind: "dive" | "battle", variant: string, n: number, settings: Record<string, unknown>) {
  const code = await createRoom(kind, variant);
  const bots = Array.from({ length: n }, (_, i) => new Bot(code, `sim-var-${variant}-${run}-${i}`, `${variant.slice(0, 4)}${i}`));
  for (const b of bots) await b.connect();
  await bots[0].waitFor((m) => m.type === "state" && m.state.players.length === n, 5000);
  bots[0].send({ type: "settings", settings: { source: "unlimited", ...settings } as never });
  await sleep(300);
  return bots;
}
const latest = (b: Bot) => b.state as State;

try {
  // ---- Co-op ----
  {
    const bots = await room("dive", "coop", 2, { questionCount: 3, timerSeconds: 15 });
    checks.check("co-op room remembers its variant", (latest(bots[0]).settings as { variant?: string }).variant === "coop");
    bots[0].send({ type: "start" });
    for (let i = 0; i < 3; i++) {
      const q = (await bots[0].waitFor((m) => m.type === "question" && m.index === i)) as Extract<ServerMessage, { type: "question" }>;
      bots[0].send({ type: "guess", text: pick(q.prompt, 100) });
      bots[1].send({ type: "guess", text: pick(q.prompt, 85) });
      await bots[0].waitFor((m) => m.type === "reveal" && m.index === i, 20_000);
      if (i === 0) checks.check("co-op snapshot shows team total and target", !!latest(bots[0]).dive?.coop?.target);
      bots[0].send({ type: "next" });
    }
    await bots[0].waitFor((m) => m.type === "gameOver", 20_000);
    await sleep(300);
    const res = latest(bots[0]).results!;
    checks.check("co-op result reports success against the target", !!res.coop && res.coop.success === res.coop.total >= res.coop.target, JSON.stringify(res.coop));
    checks.check("co-op: everyone shares the same rank", new Set(res.results.map((r) => r.rank)).size === 1);
    bots.forEach((b) => b.close());
  }

  // ---- Shark Tank ----
  {
    const bots = await room("dive", "shark", 3, { questionCount: 5, timerSeconds: 15 });
    bots[0].send({ type: "start" });
    let q = (await bots[0].waitFor((m) => m.type === "question" && m.index === 0)) as Extract<ServerMessage, { type: "question" }>;
    bots[0].send({ type: "guess", text: pick(q.prompt, 100) });
    bots[1].send({ type: "guess", text: pick(q.prompt, 60) });
    bots[2].send({ type: "guess", text: pick(q.prompt, 10) });
    const r1 = (await bots[0].waitFor((m) => m.type === "reveal" && m.index === 0, 20_000)) as Extract<ServerMessage, { type: "reveal" }>;
    checks.check("shark bites the most common answer", r1.perPlayer.find((r) => r.playerId === bots[2].playerId)?.bitten === true && !r1.perPlayer.find((r) => r.playerId === bots[0].playerId)?.bitten);
    bots[0].send({ type: "next" });
    q = (await bots[0].waitFor((m) => m.type === "question" && m.index === 1)) as Extract<ServerMessage, { type: "question" }>;
    bots[2].send({ type: "guess", text: pick(q.prompt, 100) });
    bots[0].send({ type: "guess", text: pick(q.prompt, 100) });
    bots[1].send({ type: "guess", text: pick(q.prompt, 10) });
    const r2 = (await bots[0].waitFor((m) => m.type === "reveal" && m.index === 1, 20_000)) as Extract<ServerMessage, { type: "reveal" }>;
    checks.check("bitten divers can't answer any more", !r2.perPlayer.some((r) => r.playerId === bots[2].playerId));
    bots[0].send({ type: "next" });
    await bots[0].waitFor((m) => m.type === "gameOver", 20_000);
    await sleep(300);
    const res = latest(bots[0]).results!;
    checks.check("shark ends when one diver is left, and they win", res.results[0].playerId === bots[0].playerId && res.results[0].rank === 1 && res.results.filter((r) => r.rank === 1).length === 1);
    bots.forEach((b) => b.close());
  }

  // ---- Bluff ----
  {
    const bots = await room("dive", "bluff", 3, { questionCount: 3, timerSeconds: 15 });
    bots[0].send({ type: "start" });
    const q = (await bots[0].waitFor((m) => m.type === "question" && m.index === 0)) as Extract<ServerMessage, { type: "question" }>;
    const texts = [pick(q.prompt, 100), pick(q.prompt, 30), pick(q.prompt, 10)];
    bots.forEach((b, i) => b.send({ type: "guess", text: texts[i] }));
    await bots[0].waitFor((m) => m.type === "state" && m.state.phase === "vote", 10_000);
    await sleep(200);
    const vote = latest(bots[1]).dive!.vote!;
    checks.check("bluff: a vote with one anonymous option per answer", vote.options.length === 3 && vote.options.every((o) => !("answerIds" in o)));
    // Bot 1 and 2 vote for the rarest (bot 0's); bot 0 votes for bot 1's.
    const optFor = (b: Bot) => latest(b).dive!.vote!;
    const rarest = optFor(bots[1]).options.find((o) => o.id !== optFor(bots[1]).yourOptionId && o.id !== optFor(bots[2]).yourOptionId)!.id;
    bots[1].send({ type: "vote", optionId: rarest });
    bots[2].send({ type: "vote", optionId: rarest });
    bots[0].send({ type: "vote", optionId: optFor(bots[1]).yourOptionId! });
    const rv = (await bots[0].waitFor((m) => m.type === "reveal", 20_000)) as Extract<ServerMessage, { type: "reveal" }>;
    const row = (b: Bot) => rv.perPlayer.find((r) => r.playerId === b.playerId)!;
    checks.check("bluff: spotting the rarest answer earns the bonus", row(bots[1]).votedRight === true && row(bots[0]).votedRight === false, `${row(bots[1]).points} pts`);
    bots.forEach((b) => b.close());
  }

  // ---- Hot Potato ----
  {
    const bots = await room("battle", "hotpotato", 2, { lives: 2, baseSeconds: 8 });
    let rotations = 0;
    bots[0].on((m) => m.type === "rotate" && rotations++);
    for (const b of bots) {
      b.on((m) => {
        if (m.type === "turn" && m.playerId === b.playerId) b.send({ type: "guess", text: pick(m.prompt, 30) });
      });
    }
    bots[0].send({ type: "start" });
    await sleep(9000);
    checks.check("hot potato: a new prompt after every turn", rotations >= 2, `${rotations} rotations`);
    bots.forEach((b) => b.close());
  }

  // ---- Relay ----
  {
    const bots = await room("battle", "relay", 2, { lives: 1, baseSeconds: 6 });
    bots[0].send({ type: "start" });
    await bots[0].waitFor((m) => m.type === "state" && m.state.phase === "turn", 5000);
    await sleep(200);
    const st = latest(bots[0]);
    checks.check("relay: players are split into two teams", new Set(st.players.map((p) => p.team)).size === 2 && !!st.battle?.teamLives);
    const first = st.battle!.turnPlayerId === bots[0].playerId ? bots[0] : bots[1];
    const second = first === bots[0] ? bots[1] : bots[0];
    const prompt = st.battle!.prompt;
    const answers = book.get(prompt) ?? [];
    first.send({ type: "guess", text: answers[0].text });
    await second.waitFor((m) => m.type === "turn" && m.playerId === second.playerId, 10_000);
    await sleep(200);
    const letter = latest(second).battle!.letter;
    const strip = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    checks.check("relay: the chain letter is the last letter of the previous answer (or free)", letter === null || letter === strip(answers[0].text).slice(-1), String(letter));
    if (letter) {
      const wrong = answers.find((a) => a.text !== answers[0].text && strip(a.text)[0] !== letter);
      if (wrong) {
        second.send({ type: "guess", text: wrong.text });
        const g = (await second.waitFor((m) => m.type === "guessResult")) as Extract<ServerMessage, { type: "guessResult" }>;
        checks.check("relay: a valid answer with the wrong first letter is refused", !g.accepted && g.reason === "letter");
      }
    }
    // Let both time out: team lives 1 → the first team to fail loses, the other team wins.
    await bots[0].waitFor((m) => m.type === "gameOver", 30_000);
    await sleep(300);
    const res = latest(bots[0]).results!;
    checks.check("relay: the surviving team wins together", typeof res.winningTeam === "number" && res.results.filter((r) => r.rank === 1).every((r) => r.team === res.winningTeam));
    bots.forEach((b) => b.close());
  }

  // ---- Switching game type and editing teams in the lobby ----
  {
    const code = await createRoom("dive");
    const bots = Array.from({ length: 3 }, (_, i) => new Bot(code, `sim-var-switch-${run}-${i}`, `Sw${i}`));
    for (const b of bots) await b.connect();
    const host = bots[0];
    await host.waitFor((m) => m.type === "state" && m.state.players.length === 3, 5000);
    host.send({ type: "mode", kind: "battle", variant: "relay" });
    await sleep(400);
    let st = latest(host);
    checks.check("a Dive room can switch to Battle (Relay) in the lobby", st.kind === "battle" && (st.settings as { variant?: string }).variant === "relay");
    checks.check("switching to Relay puts everyone on a team", st.players.every((p) => p.team === 0 || p.team === 1) && new Set(st.players.map((p) => p.team)).size === 2);
    bots[1].send({ type: "team", playerId: bots[2].playerId, team: 0 }); // not the host: ignored
    for (const b of bots) host.send({ type: "team", playerId: b.playerId, team: 0 });
    await sleep(400);
    st = latest(host);
    checks.check("the host can move players between teams", st.players.every((p) => p.team === 0));
    host.inbox.length = 0;
    host.send({ type: "start" });
    const err = (await host.waitFor((m) => m.type === "error", 3000).catch(() => null)) as Extract<ServerMessage, { type: "error" }> | null;
    checks.check("Relay won't start with an empty team", !!err && /team/i.test(err.message), err?.message);
    host.send({ type: "team", playerId: bots[2].playerId, team: 1 });
    await sleep(300);
    host.send({ type: "start" });
    await host.waitFor((m) => m.type === "state" && m.state.phase === "turn", 5000);
    st = latest(host);
    checks.check("the game keeps the host's teams", st.players.find((p) => p.id === bots[2].playerId)?.team === 1 && st.players.filter((p) => p.team === 0).length === 2);
    host.send({ type: "mode", kind: "dive", variant: "classic" });
    await sleep(300);
    checks.check("the game type can't change mid-game", latest(host).kind === "battle");
    bots.forEach((b) => b.close());
  }
} finally {
  stop();
}
console.log(checks.ok ? "\nVARIANTS SIMULATION PASSED" : "\nVARIANTS SIMULATION FAILED");
process.exit(checks.ok ? 0 : 1);
