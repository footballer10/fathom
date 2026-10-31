import { MATCHER_AMBIGUITY } from "../config";
import type { MatchReason, MatchResult } from "../types";
import { phoneticCodes } from "./buildIndex";
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

/**
 * True when the guess is the answer itself: its canonical text, or that text
 * with the prompt's noun left off or added ("blue" / "blue cheese" for
 * "Blue cheese", "cheddar cheese" for "Cheddar"). Only called for keys
 * already in the exact index, so a longer key here is always a real head-noun form.
 */
function isOwnSpelling(key: string, canonical: string): boolean {
  const words = normalize(canonical).split(" ").filter(Boolean);
  const full = words.join("");
  if (key === full) return true;
  if (words.length > 1 && key === words.slice(0, -1).join("")) return true;
  return key.length >= full.length + 3 && key.startsWith(full);
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
 * The answer matcher. Pipeline, in order (spec §4):
 *   1. normalize the guess
 *   2. exact lookup (canonical answers + aliases + pre-generated misspellings)
 *   3. near-miss block
 *   4. fuzzy match with Damerau-Levenshtein + an ambiguity guard
 *   5. phonetic match (Double Metaphone)
 *   6. multi-word tolerance (spaces/hyphens via compact keys, word-order swaps)
 * Deterministic, no AI, and well under 2ms per guess.
 */
export function matchGuess(index: AnswerIndex, guess: string, opts: MatchOptions = {}): MatchResult {
  // 1. Normalize. Comparisons use the compact (space-free) key, which also
  //    gives us "ice cream" = "icecream" = "ice-cream" for free (step 6).
  const key = compact(normalize(guess));
  if (!key) return reject("wrong");

  // 2. Exact lookup.
  const exact = index.exact[key];
  // Only the answer's own spelling (plural, accents and case aside) counts as exact. Aliases and
  // stored misspellings still match, but flagged as corrected, so the game asks "Did you mean…?".
  if (exact !== undefined) return accept(index, exact, !isOwnSpelling(key, index.answers[exact].canonical), opts);

  // 3. Near-miss block: a known wrong answer is rejected outright, even if it's
  //    one typo away from something valid.
  if (index.nearMisses.includes(key)) return reject("wrong");

  // 6b. Word-order swaps of 2–3 word answers ("cream ice" → "Ice cream").
  const swapped = index.reordered[key];
  if (swapped !== undefined) return accept(index, swapped, true, opts);

  // 4. Fuzzy match.
  const threshold = fuzzyThreshold(key.length);

  // Best (lowest) distance per answer. Several forms of one answer count once.
  const best = new Map<number, number>();
  const window = Math.min(threshold, MAX_LENGTH_WINDOW);
  if (threshold > 0) for (let len = key.length - window; len <= key.length + window; len++) {
    const forms = index.byLength[len];
    if (!forms) continue;
    for (const [form, a] of forms) {
      // A typo has to keep the first letter: "bat" never becomes "cat".
      if (form[0] !== key[0]) continue;
      const d = damerauLevenshtein(key, form, threshold);
      if (d > threshold) continue;
      const prev = best.get(a);
      if (prev === undefined || d < prev) best.set(a, d);
    }
  }
  if (best.size === 0) return phoneticMatch(index, key, threshold, opts);

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

/**
 * Step 5: sounds-alike match ("fushia" → "fuchsia"). Accept when the guess's
 * Double Metaphone code points at exactly one answer and the spelling is still
 * within the typo threshold (at least 1 edit) of that answer's form. Short
 * guesses (under 4 letters) never match by sound alone.
 */
function phoneticMatch(index: AnswerIndex, key: string, threshold: number, opts: MatchOptions): MatchResult {
  if (key.length < 4) return reject("wrong");
  const limit = Math.max(1, threshold);
  const hits = new Map<number, number>();
  for (const code of phoneticCodes(key)) {
    for (const [form, a] of index.phonetic?.[code] ?? []) {
      const d = damerauLevenshtein(key, form, limit);
      if (d <= limit && (!hits.has(a) || d < hits.get(a)!)) hits.set(a, d);
    }
  }
  if (hits.size !== 1) return reject(hits.size > 1 ? "ambiguous" : "wrong");
  const [[a, d]] = [...hits.entries()];
  // Same near-miss rule as the fuzzy step.
  for (const miss of index.nearMisses) {
    if (damerauLevenshtein(key, miss, d) <= d) return reject("wrong");
  }
  return accept(index, a, true, opts);
}

/**
 * For the learning loop: which answer was a rejected guess closest to, and how far?
 * Only looks at forms within ±4 characters, so it stays cheap.
 */
export function closestAnswer(index: AnswerIndex, guess: string): { answerId: string; distance: number } | null {
  const key = compact(normalize(guess));
  if (!key) return null;
  let best: { a: number; d: number } | null = null;
  for (let len = Math.max(1, key.length - 4); len <= key.length + 4; len++) {
    for (const [form, a] of index.byLength[len] ?? []) {
      const d = damerauLevenshtein(key, form, best ? best.d : 6);
      if (d <= 6 && (!best || d < best.d)) best = { a, d };
    }
  }
  return best ? { answerId: index.answers[best.a].id, distance: best.d } : null;
}
