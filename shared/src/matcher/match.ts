import { MATCHER_AMBIGUITY } from "../config";
import type { MatchReason, MatchResult } from "../types";
import type { AnswerIndex } from "./buildIndex";
import { damerauLevenshtein, fuzzyThreshold } from "./distance";
import { compact, normalize } from "./normalize";

export interface MatchOptions {
  /** Answer IDs already used (Battle mode). A guess that lands on one is rejected as "taken". */
  takenAnswerIds?: ReadonlySet<string>;
}

/** Spec §4: only compare fuzzy forms whose length is within ±3 of the guess. */
const MAX_LENGTH_WINDOW = 3;

function reject(reason: MatchReason): MatchResult {
  return {
    accepted: false,
    answerId: null,
    canonical: null,
    tier: null,
    points: 0,
    corrected: false,
    reason,
  };
}

function accept(index: AnswerIndex, a: number, corrected: boolean, opts: MatchOptions): MatchResult {
  const ans = index.answers[a];
  if (opts.takenAnswerIds?.has(ans.id)) {
    return { ...reject("taken"), answerId: ans.id, canonical: ans.canonical };
  }
  return {
    accepted: true,
    answerId: ans.id,
    canonical: ans.canonical,
    tier: ans.tier,
    points: ans.tier,
    corrected,
    reason: null,
  };
}

/**
 * Matcher v1 (Phase 1). Pipeline, in order:
 *   1. normalize the guess
 *   2. exact lookup (canonical answers + aliases)
 *   3. near-miss block
 *   4. fuzzy match with Damerau-Levenshtein + an ambiguity guard
 *   6. multi-word tolerance (spaces/hyphens via compact keys, word-order swaps)
 * Step 5 (Double Metaphone phonetic match) arrives with the full matcher in Phase 2.
 */
export function matchGuess(index: AnswerIndex, guess: string, opts: MatchOptions = {}): MatchResult {
  // 1. Normalize. Comparisons use the compact (space-free) key, which also
  //    gives us "ice cream" = "icecream" = "ice-cream" for free (step 6).
  const key = compact(normalize(guess));
  if (!key) return reject("wrong");

  // 2. Exact lookup.
  const exact = index.exact[key];
  if (exact !== undefined) return accept(index, exact, false, opts);

  // 3. Near-miss block: a known wrong answer is rejected outright, even if it's
  //    one typo away from something valid.
  if (index.nearMisses.includes(key)) return reject("wrong");

  // 6b. Word-order swaps of 2–3 word answers ("cream ice" → "Ice cream").
  const swapped = index.reordered[key];
  if (swapped !== undefined) return accept(index, swapped, true, opts);

  // 4. Fuzzy match.
  const threshold = fuzzyThreshold(key.length);
  if (threshold === 0) return reject("wrong");

  // Best (lowest) distance per answer. Several forms of one answer count once.
  const best = new Map<number, number>();
  const window = Math.min(threshold, MAX_LENGTH_WINDOW);
  for (let len = key.length - window; len <= key.length + window; len++) {
    const forms = index.byLength[len];
    if (!forms) continue;
    for (const [form, a] of forms) {
      const d = damerauLevenshtein(key, form, threshold);
      if (d > threshold) continue;
      const prev = best.get(a);
      if (prev === undefined || d < prev) best.set(a, d);
    }
  }
  if (best.size === 0) return reject("wrong");

  // Ambiguity guard. Sort candidates by distance; the winner must be unique
  // ("strict": the only answer within the threshold; "unique-closest": strictly
  // closer than every other candidate). Austria vs Australia lives here.
  const ranked = [...best.entries()].sort((x, y) => x[1] - y[1]);
  const [winner, winnerDist] = ranked[0];
  if (ranked.length > 1) {
    if (MATCHER_AMBIGUITY === "strict") return reject("ambiguous");
    if (ranked[1][1] === winnerDist) return reject("ambiguous");
  }

  // The winner must also be strictly closer than any near-miss, so
  // "switzerlnd" doesn't sneak in as a typo of something on an EU list.
  for (const miss of index.nearMisses) {
    if (Math.abs(miss.length - key.length) > winnerDist) continue;
    if (damerauLevenshtein(key, miss, winnerDist) <= winnerDist) return reject("wrong");
  }

  return accept(index, winner, true, opts);
}
