import type { TierPoints } from "../config";
import type { QuestionData } from "../types";
import { compact, normalize } from "./normalize";

/**
 * A question's precompiled answer index. Built once (at seed time in later
 * phases; on load in the Phase 1 mock) and stored as plain JSON, so it can
 * live in KV under `qidx:<questionId>`.
 */
export interface AnswerIndex {
  questionId: string;
  answers: { id: string; canonical: string; tier: TierPoints }[];
  /** Compact form → index into `answers`. Covers canonicals and aliases. */
  exact: Record<string, number>;
  /** Word-order swaps of 2–3 word forms ("cream ice" → "ice cream"). Counts as a correction. */
  reordered: Record<string, number>;
  /** Fuzzy candidates grouped by compact length: [form, answerIndex][]. */
  byLength: Record<number, [string, number][]>;
  /** Compact forms of known invalid answers. */
  nearMisses: string[];
}

export function answerId(questionId: string, i: number): string {
  return `${questionId}-a${i}`;
}

/** All orderings of a short list (used for 2–3 word answers). */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

export function buildIndex(q: QuestionData): AnswerIndex {
  const index: AnswerIndex = {
    questionId: q.id,
    answers: [],
    exact: {},
    reordered: {},
    byLength: {},
    nearMisses: [],
  };
  // Fuzzy forms are de-duplicated per answer so the same string isn't checked twice.
  const seenForm = new Set<string>();
  const addForm = (form: string, a: number, primary: boolean) => {
    if (!form) return;
    // If two answers share a form, the first one listed keeps it (the validator flags these).
    if (primary) index.exact[form] ??= a;
    else if (!(form in index.exact)) index.reordered[form] ??= a;
    const key = `${form}#${a}`;
    if (seenForm.has(key)) return;
    seenForm.add(key);
    (index.byLength[form.length] ??= []).push([form, a]);
  };

  q.answers.forEach((ans, a) => {
    index.answers.push({ id: answerId(q.id, a), canonical: ans.text, tier: ans.tier });
    for (const raw of [ans.text, ...(ans.aliases ?? [])]) {
      const n = normalize(raw);
      addForm(compact(n), a, true);
    }
  });

  // Word-order swaps ("cream ice" → "ice cream") for 2–3 word forms, added after all
  // primary forms so they never shadow another answer's real spelling.
  q.answers.forEach((ans, a) => {
    for (const raw of [ans.text, ...(ans.aliases ?? [])]) {
      const words = normalize(raw).split(" ");
      if (words.length < 2 || words.length > 3) continue;
      for (const p of permutations(words)) addForm(p.join(""), a, false);
    }
  });

  index.nearMisses = (q.nearMisses ?? []).map((m) => compact(normalize(m))).filter(Boolean);
  return index;
}
