import { TIERS } from "../config";
import type { Category, TierPoints } from "../config";
import type { AnswerData } from "../types";

/**
 * Parser and serializer for the plain-text question format (spec §5).
 * This is what gets pasted into the admin portal and what the weekly task writes.
 *
 *   # QUESTION
 *   date: 2026-11-02          (or `pool: unlimited` / `pool: reserve`)
 *   slot: 1
 *   category: food
 *   prompt: Name a fruit
 *   note: optional
 *
 *   [One in a Krillion]
 *   Jabuticaba | jaboticaba
 *   ...
 *   [Not accepted]
 *   Tomato sauce
 *
 *   # FIXES
 *   question: q0142
 *   alias: Persimmon | persimen
 *   add: Rare | Salak | snake fruit
 *   reject: tomato sauce
 */

export type QuestionPool = "unlimited" | "reserve";

export interface ParsedQuestion {
  /** Present when editing an existing question (export → edit → import). */
  id?: string;
  date?: string;
  slot?: number;
  pool?: QuestionPool;
  category: Category | string;
  prompt: string;
  note?: string;
  answers: AnswerData[];
  nearMisses: string[];
  /** 1-based line number of the "# QUESTION" header, for error messages. */
  line: number;
}

export interface ParsedFixes {
  questionId: string;
  aliases: { answer: string; aliases: string[] }[];
  adds: { tier: TierPoints; text: string; aliases: string[] }[];
  rejects: string[];
  line: number;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  fixes: ParsedFixes[];
  errors: ParseError[];
}

const TIER_BY_NAME = new Map<string, TierPoints>(TIERS.map((t) => [t.name.toLowerCase(), t.points]));
const NOT_ACCEPTED = "not accepted";

export function tierFromName(name: string): TierPoints | undefined {
  return TIER_BY_NAME.get(name.trim().toLowerCase().replace(/\s+/g, " "));
}

function splitPipes(line: string): string[] {
  return line
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parsePlainText(text: string): ParseResult {
  const result: ParseResult = { questions: [], fixes: [], errors: [] };
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  let q: ParsedQuestion | null = null;
  let fx: ParsedFixes | null = null;
  let section: TierPoints | "not accepted" | null = null;
  const err = (line: number, message: string) => result.errors.push({ line, message });

  const finishQuestion = () => {
    if (!q) return;
    if (!q.prompt) err(q.line, "Question is missing `prompt:`");
    if (!q.category) err(q.line, `"${q.prompt || "question"}" is missing \`category:\``);
    if (q.answers.length === 0) err(q.line, `"${q.prompt || "question"}" has no answers`);
    if (q.date && !q.slot) err(q.line, `"${q.prompt}" has a date but no \`slot:\``);
    if (q.slot && !q.date) err(q.line, `"${q.prompt}" has a slot but no \`date:\``);
    result.questions.push(q);
    q = null;
  };
  const finishFixes = () => {
    if (!fx) return;
    if (!fx.questionId) err(fx.line, "FIXES block is missing `question:`");
    result.fixes.push(fx);
    fx = null;
  };

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;

    if (/^#\s*question\s*$/i.test(line)) {
      finishQuestion();
      finishFixes();
      q = { category: "", prompt: "", answers: [], nearMisses: [], line: n };
      section = null;
      return;
    }
    if (/^#\s*fixes\s*$/i.test(line)) {
      finishQuestion();
      finishFixes();
      fx = { questionId: "", aliases: [], adds: [], rejects: [], line: n };
      return;
    }

    if (fx) {
      const m = line.match(/^(question|alias|add|reject)\s*:\s*(.*)$/i);
      if (!m) return err(n, `Unrecognized line in FIXES block: "${line}"`);
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === "question") fx.questionId = value;
      else if (key === "reject") fx.rejects.push(...splitPipes(value));
      else if (key === "alias") {
        const [answer, ...aliases] = splitPipes(value);
        if (!answer || aliases.length === 0) return err(n, "`alias:` needs an answer and at least one alias");
        fx.aliases.push({ answer, aliases });
      } else {
        const [tierName, text, ...aliases] = splitPipes(value);
        const tier = tierName ? tierFromName(tierName) : undefined;
        if (!tier) return err(n, `\`add:\` needs a tier name first, got "${tierName ?? ""}"`);
        if (!text) return err(n, "`add:` needs an answer after the tier");
        fx.adds.push({ tier, text, aliases });
      }
      return;
    }

    if (!q) return err(n, `Text outside a "# QUESTION" or "# FIXES" block: "${line}"`);
    const cur: ParsedQuestion = q;

    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      const name = header[1].trim().toLowerCase();
      if (name === NOT_ACCEPTED) section = NOT_ACCEPTED;
      else {
        const t = tierFromName(name);
        if (!t) return err(n, `Unknown tier header "[${header[1]}]"`);
        section = t;
      }
      return;
    }

    if (section === null) {
      const m = line.match(/^([a-z]+)\s*:\s*(.*)$/i);
      if (!m) return err(n, `Expected "key: value" before the first tier header, got "${line}"`);
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      switch (key) {
        case "id":
          cur.id = value;
          break;
        case "date":
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) err(n, `Date must look like 2026-11-02, got "${value}"`);
          cur.date = value;
          break;
        case "slot": {
          const slot = Number(value);
          if (!Number.isInteger(slot) || slot < 1 || slot > 7) err(n, `Slot must be 1–7, got "${value}"`);
          cur.slot = slot;
          break;
        }
        case "pool":
          if (value !== "unlimited" && value !== "reserve") err(n, `Pool must be "unlimited" or "reserve", got "${value}"`);
          cur.pool = value as QuestionPool;
          break;
        case "category":
          cur.category = value.toLowerCase();
          break;
        case "prompt":
          cur.prompt = value;
          break;
        case "note":
        case "notes":
          cur.note = value;
          break;
        default:
          err(n, `Unknown field "${key}:"`);
      }
      return;
    }

    if (section === NOT_ACCEPTED) {
      cur.nearMisses.push(...splitPipes(line));
      return;
    }
    const [text, ...aliases] = splitPipes(line);
    if (!text) return;
    cur.answers.push(aliases.length ? { text, aliases, tier: section } : { text, tier: section });
  });

  finishQuestion();
  finishFixes();
  return result;
}

export function serializeQuestion(q: Omit<ParsedQuestion, "line"> & { line?: number }): string {
  const out: string[] = ["# QUESTION"];
  if (q.id) out.push(`id: ${q.id}`);
  if (q.date) out.push(`date: ${q.date}`, `slot: ${q.slot}`);
  else if (q.pool) out.push(`pool: ${q.pool}`);
  out.push(`category: ${q.category}`, `prompt: ${q.prompt}`);
  if (q.note) out.push(`note: ${q.note}`);
  for (const t of TIERS) {
    const answers = q.answers.filter((a) => a.tier === t.points);
    if (!answers.length) continue;
    out.push("", `[${t.name}]`);
    for (const a of answers) out.push([a.text, ...(a.aliases ?? [])].join(" | "));
  }
  if (q.nearMisses.length) out.push("", "[Not accepted]", ...q.nearMisses);
  return out.join("\n") + "\n";
}

export function serializeQuestions(qs: (Omit<ParsedQuestion, "line"> & { line?: number })[]): string {
  return qs.map(serializeQuestion).join("\n");
}

export function serializeFixes(f: Omit<ParsedFixes, "line">): string {
  const out = ["# FIXES", `question: ${f.questionId}`];
  for (const a of f.aliases) out.push(`alias: ${[a.answer, ...a.aliases].join(" | ")}`);
  for (const a of f.adds) {
    const name = TIERS.find((t) => t.points === a.tier)!.name;
    out.push(`add: ${[name, a.text, ...a.aliases].join(" | ")}`);
  }
  for (const r of f.rejects) out.push(`reject: ${r}`);
  return out.join("\n") + "\n";
}
