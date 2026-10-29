import { CATEGORIES, TIERS } from "../config";
import type { TierPoints } from "../config";
import type { AnswerData } from "../types";
import { damerauLevenshtein } from "../matcher/distance";
import { compact, normalize } from "../matcher/normalize";

/**
 * The question validator (spec §5). Used by `npm run validate:questions`,
 * the seed script, the admin Import tab, and the import API, so all four
 * apply exactly the same rules.
 */

export const MIN_ANSWERS = 50;
export const TARGET_MIN_ANSWERS = 80;
export const MAX_PROMPT_LENGTH = 80;

export interface ValidatableQuestion {
  id?: string;
  prompt: string;
  category: string;
  answers: AnswerData[];
  nearMisses?: string[];
  date?: string;
  slot?: number;
}

export interface ValidationContext {
  /** Normalized prompt → question id, for every question already in the bank. */
  existingPrompts?: Map<string, string>;
  /** "YYYY-MM-DD#slot" → question id, for every scheduled Daily slot. */
  takenSlots?: Map<string, string>;
  /** Allow overwriting scheduled date/slot pairs ("replace" import). */
  replace?: boolean;
  /** Skip the O(n²) "one typo apart" warning (used by the Worker, which has a tight CPU budget). */
  skipFuzzyPairs?: boolean;
}

export interface QuestionReport {
  index: number;
  prompt: string;
  errors: string[];
  warnings: string[];
}

export interface ValidationResult {
  ok: boolean;
  reports: QuestionReport[];
  errorCount: number;
  warningCount: number;
}

export function normalizePrompt(prompt: string): string {
  return compact(normalize(prompt));
}

const VALID_TIERS = new Set<number>(TIERS.map((t) => t.points));

/** Target range for each tier, scaled to the pool size (spec §5 rarity rules). */
export function tierTargets(n: number): Record<TierPoints, [number, number]> {
  return {
    100: [1, 1],
    10: [5, 10],
    15: [2, 5],
    30: [Math.floor(n * 0.15), Math.ceil(n * 0.35)],
    60: [Math.floor(n * 0.23), Math.ceil(n * 0.43)],
    85: [1, n],
  };
}

export function validateQuestion(q: ValidatableQuestion, ctx: ValidationContext = {}): Omit<QuestionReport, "index"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = q.prompt || "(no prompt)";

  // --- schema ------------------------------------------------------------
  if (!q.prompt?.trim()) errors.push("Missing prompt");
  else if (q.prompt.length > MAX_PROMPT_LENGTH) errors.push(`Prompt is ${q.prompt.length} characters (max ${MAX_PROMPT_LENGTH})`);
  if (!(CATEGORIES as readonly string[]).includes(q.category)) {
    errors.push(`Category "${q.category}" isn't allowed. Use one of: ${CATEGORIES.join(", ")}`);
  }
  if (!Array.isArray(q.answers)) {
    errors.push("Answers must be a list");
    return { prompt: label, errors, warnings };
  }
  q.answers.forEach((a, i) => {
    if (!a || typeof a.text !== "string" || !a.text.trim()) errors.push(`Answer #${i + 1} has no text`);
    if (!VALID_TIERS.has(a?.tier)) errors.push(`"${a?.text}" has an invalid tier (${a?.tier})`);
    if (a?.aliases !== undefined && !Array.isArray(a.aliases)) errors.push(`"${a.text}" aliases must be a list`);
  });
  if (q.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) errors.push(`Bad date "${q.date}"`);
  if (q.slot !== undefined && (!Number.isInteger(q.slot) || q.slot < 1 || q.slot > 7)) errors.push(`Bad slot "${q.slot}"`);

  // --- pool size and tiers ------------------------------------------------
  const n = q.answers.length;
  if (n < MIN_ANSWERS) errors.push(`Only ${n} answers (minimum ${MIN_ANSWERS})`);
  else if (n < TARGET_MIN_ANSWERS) warnings.push(`${n} answers (target is ${TARGET_MIN_ANSWERS}–250)`);

  const counts = new Map<number, number>();
  for (const a of q.answers) counts.set(a.tier, (counts.get(a.tier) ?? 0) + 1);
  const krillions = counts.get(100) ?? 0;
  if (krillions !== 1) errors.push(`Needs exactly one One in a Krillion answer (has ${krillions})`);
  const targets = tierTargets(n);
  for (const t of TIERS) {
    if (t.points === 100) continue;
    const c = counts.get(t.points) ?? 0;
    const [lo, hi] = targets[t.points];
    if (c < lo || c > hi) warnings.push(`${t.name}: ${c} answers (target ${lo}–${hi})`);
  }

  // --- duplicates across answers -----------------------------------------
  const owner = new Map<string, number>(); // compact form → answer index
  const forms: { form: string; a: number }[] = [];
  q.answers.forEach((a, i) => {
    for (const raw of [a.text, ...(a.aliases ?? [])]) {
      if (typeof raw !== "string") continue;
      const form = compact(normalize(raw));
      if (!form) {
        errors.push(`"${raw}" (under "${a.text}") is empty after normalizing`);
        continue;
      }
      const prev = owner.get(form);
      if (prev !== undefined && prev !== i) {
        errors.push(`"${raw}" (under "${a.text}") duplicates "${q.answers[prev].text}"`);
      } else if (prev === undefined) {
        owner.set(form, i);
        forms.push({ form, a: i });
      }
    }
  });

  // --- near-misses --------------------------------------------------------
  for (const m of q.nearMisses ?? []) {
    const form = compact(normalize(m));
    const hit = owner.get(form);
    if (hit !== undefined) errors.push(`Not-accepted "${m}" collides with valid answer "${q.answers[hit].text}"`);
  }

  // --- fuzzy-ambiguity risk (warning) ---------------------------------------
  const risky: string[] = [];
  if (!ctx.skipFuzzyPairs) for (let i = 0; i < forms.length; i++) {
    for (let j = i + 1; j < forms.length; j++) {
      const x = forms[i];
      const y = forms[j];
      if (x.a === y.a || Math.min(x.form.length, y.form.length) < 5) continue;
      if (Math.abs(x.form.length - y.form.length) > 1) continue;
      if (damerauLevenshtein(x.form, y.form, 1) <= 1) risky.push(`${q.answers[x.a].text} / ${q.answers[y.a].text}`);
    }
  }
  if (risky.length) warnings.push(`Answers one typo apart (typos near these get rejected as ambiguous): ${[...new Set(risky)].join("; ")}`);

  // --- prompt and schedule collisions ---------------------------------------
  if (q.prompt) {
    const existing = ctx.existingPrompts?.get(normalizePrompt(q.prompt));
    if (existing && existing !== q.id) errors.push(`Prompt already exists (${existing})`);
  }
  if (q.date && q.slot) {
    const taken = ctx.takenSlots?.get(`${q.date}#${q.slot}`);
    if (taken && taken !== q.id && !ctx.replace) errors.push(`${q.date} slot ${q.slot} already has a question (${taken})`);
  }

  return { prompt: label, errors, warnings };
}

/** Validate a batch, including duplicates within the batch itself. */
export function validateQuestions(qs: ValidatableQuestion[], ctx: ValidationContext = {}): ValidationResult {
  const seenPrompts = new Map<string, number>();
  const seenSlots = new Map<string, number>();
  const reports = qs.map((q, index) => {
    const r = { index, ...validateQuestion(q, ctx) };
    if (q.prompt) {
      const key = normalizePrompt(q.prompt);
      const prev = seenPrompts.get(key);
      if (prev !== undefined) r.errors.push(`Same prompt as question #${prev + 1} in this batch`);
      else seenPrompts.set(key, index);
    }
    if (q.date && q.slot) {
      const key = `${q.date}#${q.slot}`;
      const prev = seenSlots.get(key);
      if (prev !== undefined) r.errors.push(`${q.date} slot ${q.slot} is also used by question #${prev + 1} in this batch`);
      else seenSlots.set(key, index);
    }
    return r;
  });
  const errorCount = reports.reduce((n, r) => n + r.errors.length, 0);
  const warningCount = reports.reduce((n, r) => n + r.warnings.length, 0);
  return { ok: errorCount === 0, reports, errorCount, warningCount };
}

/** Human-readable report for the CLI and the weekly task. */
export function formatValidation(result: ValidationResult, verbose = true): string {
  const lines: string[] = [];
  for (const r of result.reports) {
    if (!r.errors.length && !(verbose && r.warnings.length)) continue;
    lines.push(`#${r.index + 1} "${r.prompt}"`);
    for (const e of r.errors) lines.push(`  ERROR   ${e}`);
    if (verbose) for (const w of r.warnings) lines.push(`  warning ${w}`);
  }
  lines.push(
    result.ok
      ? `OK: ${result.reports.length} question(s), ${result.warningCount} warning(s).`
      : `FAILED: ${result.errorCount} error(s), ${result.warningCount} warning(s) in ${result.reports.length} question(s).`,
  );
  return lines.join("\n");
}
