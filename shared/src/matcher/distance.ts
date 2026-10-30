/**
 * Damerau-Levenshtein distance (optimal string alignment variant):
 * insertions, deletions, substitutions and adjacent transpositions each cost 1.
 *
 * `max` lets us bail out early: as soon as every cell in a row exceeds `max`,
 * no later row can get back under it, so we return max + 1. This keeps the
 * fuzzy step cheap even on questions with thousands of answer forms.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Three rolling rows: two rows back (for transpositions), previous, current.
  let prev2 = new Array<number>(lb + 1).fill(0);
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = curr;
    curr = t;
  }
  return prev[lb];
}

/** Allowed typo distance for a normalized guess of this length (spec §4 step 4). */
export function fuzzyThreshold(length: number): number {
  if (length <= 5) return 0;
  if (length <= 9) return 1;
  if (length <= 14) return 2;
  return 3;
}
