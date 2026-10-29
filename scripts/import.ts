/**
 * npm run import -- content/incoming/<file>.txt [more files] [--fill | --unlimited] [--replace] [--dry-run] [--local]
 *
 * Validates the file(s) with the full validator, then uploads each question
 * (and FIXES block) to the admin API one at a time. Prints a summary and exits
 * with code 1 if anything failed, so the weekly task can report it.
 *   default      use the date/slot or pool in the file
 *   --fill       put questions in the next open Daily slots
 *   --unlimited  add everything to Unlimited
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { formatValidation, normalizePrompt, parsePlainText, validateQuestions } from "../shared/src/index";
import { adminFetch } from "./lib/admin-client";

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
const mode = argv.includes("--unlimited") ? "unlimited" : argv.includes("--fill") ? "fill" : "file";
const replace = argv.includes("--replace");
const dryRun = argv.includes("--dry-run");
if (!files.length) {
  console.error("Usage: npm run import -- content/incoming/<file>.txt");
  process.exit(1);
}

// Fresh duplicate-check context from the live site.
const status = await adminFetch<{ prompts: { id: string; prompt: string }[]; scheduled: { id: string; date: string; slot: number }[] }>(
  "/api/admin/status",
);
const existingPrompts = new Map(status.prompts.map((p) => [normalizePrompt(p.prompt), p.id]));
const takenSlots = new Map(status.scheduled.map((s) => [`${s.date}#${s.slot}`, s.id]));

let failures = 0;
for (const file of files) {
  console.log(`\n=== ${basename(file)} ===`);
  const parsed = parsePlainText(readFileSync(file, "utf8"));
  if (parsed.errors.length) {
    for (const e of parsed.errors) console.log(`  line ${e.line}: ${e.message}`);
    console.log("  Not uploaded: fix the format errors above first.");
    failures++;
    continue;
  }
  // Edits (questions with an id:) are allowed to keep their own prompt and slot.
  const ctxPrompts = new Map(existingPrompts);
  const ctxSlots = new Map(takenSlots);
  const result = validateQuestions(
    parsed.questions.map((q) => ({ ...q, date: mode === "file" ? q.date : undefined, slot: mode === "file" ? q.slot : undefined })),
    { existingPrompts: ctxPrompts, takenSlots: ctxSlots, replace },
  );
  console.log(formatValidation(result, false));
  if (!result.ok) {
    console.log("  Not uploaded: fix the errors above, then run import again.");
    failures++;
    continue;
  }
  if (dryRun) {
    console.log(`  Dry run: ${parsed.questions.length} question(s) and ${parsed.fixes.length} FIXES block(s) would be uploaded.`);
    continue;
  }

  let ok = 0;
  for (const q of parsed.questions) {
    try {
      const r = await adminFetch<{ ok: boolean; id?: string; status?: string; date?: string; slot?: number; errors?: string[] }>(
        "/api/admin/question",
        { body: { question: q, mode, replace, source: "weekly" } },
      );
      if (r.ok) {
        ok++;
        console.log(`  + ${r.id}  ${q.prompt}  →  ${r.status}${r.date ? ` ${r.date} slot ${r.slot}` : ""}`);
      } else {
        failures++;
        console.log(`  ✗ ${q.prompt}: ${(r.errors ?? []).join("; ")}`);
      }
    } catch (err) {
      failures++;
      console.log(`  ✗ ${q.prompt}: upload failed (${(err as Error).message})`);
    }
  }
  for (const f of parsed.fixes) {
    try {
      const r = await adminFetch<{ ok: boolean; errors?: string[] }>("/api/admin/fixes", { body: { fixes: f } });
      if (r.ok) {
        ok++;
        console.log(`  + FIXES ${f.questionId} (${f.aliases.length} alias, ${f.adds.length} add, ${f.rejects.length} reject)`);
      } else {
        failures++;
        console.log(`  ✗ FIXES ${f.questionId}: ${(r.errors ?? []).join("; ")}`);
      }
    } catch (err) {
      failures++;
      console.log(`  ✗ FIXES ${f.questionId}: upload failed (${(err as Error).message})`);
    }
  }
  console.log(`  Uploaded ${ok} item(s) from ${basename(file)}.`);
}

if (failures) {
  console.log(`\nIMPORT FINISHED WITH ${failures} PROBLEM(S). Anything not uploaded can be pasted into the admin portal's Import tab.`);
  process.exit(1);
}
console.log("\nImport complete.");
