import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePlainText } from "../../shared/src/index";
import type { ParsedQuestion, ParseError, QuestionData } from "../../shared/src/index";

export const ROOT = resolve(import.meta.dirname, "../..");
export const SEED_DIR = join(ROOT, "content/seed");
export const QUESTIONS_DIR = join(ROOT, "content/questions");
export const STATUS_CACHE = join(ROOT, "content/.status.json");

/** A question as stored in content/questions/*.json (the seed bank). */
export interface SeedQuestion extends QuestionData {
  status: "reserve" | "unlimited";
}

export function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => join(dir, f));
}

/** Load questions from a .txt (plain-text format) or .json (array of questions) file. */
export function loadFile(path: string): { questions: ParsedQuestion[]; errors: ParseError[]; fixesCount: number } {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const data = JSON.parse(text) as SeedQuestion[];
    return {
      questions: data.map((q, i) => ({
        id: q.id,
        pool: q.status,
        category: q.category,
        prompt: q.prompt,
        note: q.notes,
        answers: q.answers,
        nearMisses: q.nearMisses ?? [],
        line: i + 1,
      })),
      errors: [],
      fixesCount: 0,
    };
  }
  const r = parsePlainText(text);
  return { questions: r.questions, errors: r.errors, fixesCount: r.fixes.length };
}

/** The live server's prompts/schedule, cached by `npm run status` (if it has been run). */
export function loadStatusCache(): { prompts: { id: string; prompt: string }[]; scheduled: { date: string; slot: number; id: string }[] } | null {
  if (!existsSync(STATUS_CACHE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_CACHE, "utf8"));
  } catch {
    return null;
  }
}
