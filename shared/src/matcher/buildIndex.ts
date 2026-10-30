import { doubleMetaphone } from "double-metaphone";
import type { TierPoints } from "../config";
import type { AnswerData } from "../types";
import { compact, normalize } from "./normalize";

/**
 * A question's precompiled answer index. Built once at seed/import time and
 * stored as plain JSON in KV under `qidx2:<questionId>`, so the Worker never
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

/** Words that name a kind of thing rather than the thing itself ("dog breed" → "dog"). */
const GENERIC_HEADS = new Set([
  "breed", "brand", "model", "type", "kind", "variety", "term", "game", "character", "title", "name",
  "series", "franchise", "move", "trick", "event", "position", "part", "piece", "member", "winner",
]);
/** Words after which the rest of a phrase only narrows it down ("country in Africa" → "country"). */
const CUT_BEFORE = /\s(?:in|from|on|at|with|that|which|who|whose|you|people|for|by|starring|ending|beginning|made|used|grown|sold|found|played|celebrated|than|through|like)\s.*$/;

/**
 * The noun(s) a prompt asks for, normalized: "Name a type of cheese" → ["cheese"],
 * "Name a chili pepper or sweet pepper" → ["pepper"], "Name a dog breed" → ["dog"].
 * Used so "blue" matches "Blue cheese" and "blue cheese" matches "Blue".
 */
export function promptHeads(prompt: string | undefined): string[] {
  if (!prompt) return [];
  const body = normalize(prompt.replace(/\(.*?\)/g, " ").replace(/^\s*name\s+(?:an?|the|one|any)?\s*/i, ""));
  const heads = new Set<string>();
  for (let seg of body.split(/\s(?:or|and)\s|,/)) {
    seg = seg.trim();
    if (!seg) continue;
    // "type of cheese" → "cheese"; "part of a car" → "car"
    const of = seg.lastIndexOf(" of ");
    if (of >= 0) seg = seg.slice(of + 4);
    seg = seg.replace(CUT_BEFORE, "").trim();
    const words = seg.split(" ").filter((w) => w && !["a", "an", "the", "famous", "common", "popular", "classic"].includes(w));
    let head = words[words.length - 1];
    if (head && GENERIC_HEADS.has(head) && words.length > 1) head = words[words.length - 2];
    if (head && head.length >= 3 && !GENERIC_HEADS.has(head)) heads.add(head);
  }
  return [...heads];
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

  // The thing the prompt asks for is optional: for "Name a type of cheese", "blue"
  // matches "Blue cheese" and "blue cheese" matches "Blue". Added after every
  // real spelling, so a short form never takes over another answer's.
  const heads = promptHeads(q.prompt);
  if (heads.length) {
    const near = new Set((q.nearMisses ?? []).map((m) => compact(normalize(m))));
    q.answers.forEach((ans, a) => {
      for (const raw of [ans.text, ...(ans.aliases ?? [])]) {
        const words = normalize(raw).split(" ").filter(Boolean);
        for (const head of heads) {
          const extra: string[] = [];
          if (words.length > 1 && words[words.length - 1] === head) extra.push(words.slice(0, -1).join(""));
          else if (words[words.length - 1] !== head) extra.push(words.join("") + head);
          for (const form of extra) {
            if (form.length < 3 || form in index.exact || near.has(form)) continue;
            addForm(form, a, true);
          }
        }
      }
    });
  }

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
