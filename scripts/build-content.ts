/**
 * npm run content:build
 * Compiles the editable seed bank (content/seed/*.txt, plain-text format)
 * into content/questions/*.json, the format the seed script loads.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { formatValidation, validateQuestions } from "../shared/src/index";
import type { Category } from "../shared/src/index";
import { QUESTIONS_DIR, SEED_DIR, listFiles, loadFile } from "./lib/content";
import type { SeedQuestion } from "./lib/content";

mkdirSync(QUESTIONS_DIR, { recursive: true });
const files = listFiles(SEED_DIR, ".txt");
const all = [];
const ids = new Set<string>();
let bad = false;

for (const file of files) {
  const { questions, errors } = loadFile(file);
  for (const e of errors) {
    console.error(`${basename(file)}:${e.line} ${e.message}`);
    bad = true;
  }
  const out: SeedQuestion[] = questions.map((q) => {
    if (!q.id) {
      console.error(`${basename(file)}:${q.line} seed questions need an "id:" line`);
      bad = true;
    } else if (ids.has(q.id)) {
      console.error(`${basename(file)}:${q.line} duplicate id ${q.id}`);
      bad = true;
    }
    ids.add(q.id ?? "");
    return {
      id: q.id ?? "",
      prompt: q.prompt,
      category: q.category as Category,
      status: q.pool ?? "unlimited",
      answers: q.answers,
      nearMisses: q.nearMisses,
      ...(q.note ? { notes: q.note } : {}),
    };
  });
  all.push(...questions);
  writeFileSync(join(QUESTIONS_DIR, basename(file, ".txt") + ".json"), JSON.stringify(out, null, 2) + "\n");
}

const result = validateQuestions(all);
if (!result.ok) console.log(formatValidation(result, false));
if (bad || !result.ok) process.exit(1);
const reserve = all.filter((q) => q.pool === "reserve").length;
console.log(`Built ${all.length} questions from ${files.length} file(s) (${reserve} reserve, ${all.length - reserve} unlimited).`);
