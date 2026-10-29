import { describe, expect, it } from "vitest";
import { buildIndex, matchGuess } from "../src";
import type { QuestionData, TierPoints } from "../src";

/** Deterministic pseudo-random words so the benchmark is repeatable. */
function makeQuestion(): QuestionData {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const word = (min: number, max: number) => {
    const len = min + Math.floor(rand() * (max - min + 1));
    let w = "";
    for (let i = 0; i < len; i++) w += letters[Math.floor(rand() * 26)];
    return w;
  };
  const tiers: TierPoints[] = [10, 15, 30, 60, 85];
  const answers = Array.from({ length: 300 }, (_, i) => ({
    text: rand() < 0.3 ? `${word(4, 8)} ${word(4, 8)}` : word(5, 12),
    aliases: Array.from({ length: i < 100 ? 4 : 3 }, () => word(5, 12)).slice(0, i < 100 ? 4 : 3),
    tier: i === 0 ? (100 as TierPoints) : tiers[i % tiers.length],
  }));
  return { id: "bench", prompt: "bench", category: "food", answers, nearMisses: [] };
}

describe("matcher benchmark", () => {
  const q = makeQuestion();
  const aliasCount = q.answers.reduce((n, a) => n + (a.aliases?.length ?? 0), 0);
  const index = buildIndex(q);

  it("uses a question with 300 answers and 1,000 aliases", () => {
    expect(q.answers.length).toBe(300);
    expect(aliasCount).toBe(1000);
  });

  it("stays under 2ms per guess (average over typo / miss / exact guesses)", () => {
    const guesses: string[] = [];
    for (let i = 0; i < 300; i += 3) {
      const t = q.answers[i].text;
      guesses.push(t); // exact
      guesses.push(t.slice(0, -1) + "q" + t.slice(-1)); // typo, goes through the fuzzy step
      guesses.push("zzqx" + t.slice(2)); // likely miss, full fuzzy scan
    }
    // Warm up the JIT.
    for (const g of guesses) matchGuess(index, g);

    const rounds = 5;
    const start = performance.now();
    for (let r = 0; r < rounds; r++) for (const g of guesses) matchGuess(index, g);
    const perGuess = (performance.now() - start) / (rounds * guesses.length);
    console.log(`matcher: ${perGuess.toFixed(4)} ms per guess over ${rounds * guesses.length} guesses`);
    expect(perGuess).toBeLessThan(2);
  });
});
