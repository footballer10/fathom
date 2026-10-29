import { doubleMetaphone } from "double-metaphone";
import type { TierPoints } from "../config";
import type { AnswerData } from "../types";
import { compact, normalize } from "./normalize";

/**
 * A question's precompiled answer index. Built once at seed/import time and
 * stored as plain JSON in KV under `qidx:<questionId>`, so the Worker never
 * has to normalize hundreds of aliases on a guess.
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
  /** Double Metaphone code → [form, answerIndex][] (primary and secondary codes). */
  phonetic: Record<string, [string, number][]>;
  /** Compact forms of known invalid answers. */
  nearMisses: string[];
}

/** Minimal shape needed to build an index (content JSON and D1 rows both fit). */
export interface IndexableQuestion {
  id: string;
  prompt?: string;
  category?: string;
  answers: (AnswerData & { id?: string })[];
  nearMisses?: string[];
}

export function answerId(questionId: string, i: number): string {
  return `${questionId}-a${i}`;
}

/** Both Double Metaphone codes for a compact form (deduplicated, empties dropped). */
export function phoneticCodes(form: string): string[] {
  if (!form) return [];
  const [a, b] = doubleMetaphone(form);
  return a === b ? (a ? [a] : []) : [a, b].filter(Boolean);
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

export function buildIndex(q: IndexableQuestion): AnswerIndex {
  const index: AnswerIndex = {
    questionId: q.id,
    answers: [],
    exact: {},
    reordered: {},
    byLength: {},
    phonetic: {},
    nearMisses: [],
  };
  // Forms are de-duplicated per answer so the same string isn't checked twice.
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
    if (primary) for (const code of phoneticCodes(form)) (index.phonetic[code] ??= []).push([form, a]);
  };

  q.answers.forEach((ans, a) => {
    index.answers.push({ id: ans.id ?? answerId(q.id, a), canonical: ans.text, tier: ans.tier });
    for (const raw of [ans.text, ...(ans.aliases ?? [])]) addForm(compact(normalize(raw)), a, true);
  });

  // Word-order swaps for 2–3 word forms, added after all primary forms so they
  // never shadow another answer's real spelling.
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
