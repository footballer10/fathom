/**
 * npm run seed            → load the seed bank into your LOCAL dev database
 * npm run seed -- --remote → load it into the real Cloudflare D1 + KV
 * Add --force to overwrite questions that already exist (normally they're skipped).
 *
 * Steps: compile content/seed/*.txt → validate → apply D1 migrations →
 * insert questions → write precompiled answer indexes to KV (qidx2:<id>).
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, formatValidation, normalizePrompt, validateQuestions } from "../shared/src/index";
import { SEED_DIR, listFiles, loadFile } from "./lib/content";
import { WORKER_DIR, targetFlag, wrangler } from "./lib/wrangler";

const target = targetFlag(process.argv);
const force = process.argv.includes("--force");

const questions = listFiles(SEED_DIR, ".txt").flatMap((f) => loadFile(f).questions);
const result = validateQuestions(questions);
if (!result.ok) {
  console.log(formatValidation(result, false));
  process.exit(1);
}
console.log(`Seed bank OK: ${questions.length} questions.`);

console.log(`\nApplying database migrations (${target})...`);
wrangler(["d1", "migrations", "apply", "fathom", target, ...(target === "--remote" ? [] : [])], {});

const sql = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = Date.now();
const verb = force ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
const lines: string[] = [];
const kv: { key: string; value: string }[] = [];

for (const q of questions) {
  const id = q.id!;
  const answers = q.answers.map((a, i) => ({ id: `${id}-a${i}`, text: a.text, tier: a.tier, ...(a.aliases?.length ? { aliases: a.aliases } : {}) }));
  const data = JSON.stringify({ answers, nearMisses: q.nearMisses, ...(q.note ? { notes: q.note } : {}) });
  lines.push(
    `${verb} INTO questions (id, prompt, prompt_key, category, status, daily_date, daily_slot, source, data, answer_count, created_at) VALUES (${[
      id,
      q.prompt,
      normalizePrompt(q.prompt),
      q.category,
      q.pool ?? "unlimited",
      null,
      null,
      "seed",
      data,
      answers.length,
      now,
    ]
      .map(sql)
      .join(", ")});`,
  );
  kv.push({ key: `qidx2:${id}`, value: JSON.stringify(buildIndex({ id, prompt: q.prompt, answers, nearMisses: q.nearMisses })) });
}

const tmp = join(WORKER_DIR, ".wrangler", "seed");
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, "seed.sql"), lines.join("\n") + "\n");
writeFileSync(join(tmp, "kv.json"), JSON.stringify(kv));

console.log(`\nInserting questions (${target})...`);
wrangler(["d1", "execute", "fathom", target, "--file", join(".wrangler", "seed", "seed.sql"), ...(target === "--remote" ? ["--yes"] : [])], { capture: true });

console.log(`\nWriting ${kv.length} answer indexes to KV (${target})...`);
wrangler(["kv", "bulk", "put", join(".wrangler", "seed", "kv.json"), "--binding", "KV", target]);

if (target === "--local") writeFileSync(join(tmp, ".seeded-local"), String(now));
console.log(`\nDone. ${questions.length} questions are in the ${target === "--remote" ? "live" : "local"} database.`);
if (!existsSync(join(tmp, ".seeded-local")) && target === "--local") console.log("(local seed marker missing?)");
