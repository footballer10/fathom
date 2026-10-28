/**
 * npm run validate:questions [-- file1.txt file2.json ...]
 *
 * With no files: validates the whole seed bank (content/seed/*.txt).
 * With files: validates just those, and also checks them against the seed bank
 * and (if `npm run status` has been run) every prompt and Daily slot on the live site.
 * Exits with code 1 if there are any errors.
 */
import { relative } from "node:path";
import { formatValidation, normalizePrompt, validateQuestions } from "../shared/src/index";
import { ROOT, SEED_DIR, listFiles, loadFile, loadStatusCache } from "./lib/content";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const replace = process.argv.includes("--replace");
const quiet = process.argv.includes("--quiet");
const files = args.length ? args : listFiles(SEED_DIR, ".txt");

if (files.length === 0) {
  console.error("No question files found.");
  process.exit(1);
}

let failed = false;
const all = files.flatMap((file) => {
  const { questions, errors, fixesCount } = loadFile(file);
  for (const e of errors) {
    console.log(`${relative(ROOT, file)}:${e.line}  ERROR ${e.message}`);
    failed = true;
  }
  if (fixesCount) console.log(`${relative(ROOT, file)}: ${fixesCount} FIXES block(s) parsed OK.`);
  return questions;
});

// Context: prompts and slots that already exist elsewhere.
const existingPrompts = new Map<string, string>();
const takenSlots = new Map<string, string>();
if (args.length) {
  const mine = new Set(files);
  for (const f of listFiles(SEED_DIR, ".txt")) {
    if (mine.has(f)) continue;
    for (const q of loadFile(f).questions) existingPrompts.set(normalizePrompt(q.prompt), q.id ?? relative(ROOT, f));
  }
}
const status = loadStatusCache();
if (status) {
  for (const p of status.prompts) existingPrompts.set(normalizePrompt(p.prompt), p.id);
  for (const s of status.scheduled) takenSlots.set(`${s.date}#${s.slot}`, s.id);
}

const result = validateQuestions(all, { existingPrompts, takenSlots, replace });
console.log(formatValidation(result, !quiet));
if (!status && args.length) console.log("(Tip: run `npm run status` first to also check against prompts already on the live site.)");
if (failed || !result.ok) process.exit(1);
