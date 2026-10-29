/**
 * npx tsx scripts/patch-seed.ts <patch.txt>
 * Maintenance helper for the seed bank. A patch file looks like:
 *
 *   @ q0001
 *   prompt: New prompt text        (optional)
 *   note: New note                 (optional)
 *   [Rare]
 *   New Answer | alias | alias
 *   [Not accepted]
 *   wrong guess
 *   [Remove]
 *   Existing Answer
 *   [Alias]
 *   Existing Answer | new alias
 *
 * or a whole "# QUESTION" block with `id:` to replace a question outright.
 * New answers that already exist (by text or alias) are skipped, and aliases
 * that clash with another answer are dropped, so patches are safe to re-run.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compact, normalize as norm, parsePlainText, serializeQuestions, tierFromName } from "../shared/src/index";
import type { ParsedQuestion, TierPoints } from "../shared/src/index";

/** The same duplicate key the validator uses (normalized, spaces removed). */
const normalize = (s: string) => compact(norm(s));

const SEED = join(import.meta.dirname, "..", "content", "seed");
const patchText = readFileSync(process.argv[2], "utf8");

// Load every seed file, keeping its header comment.
const files = readdirSync(SEED).filter((f) => f.endsWith(".txt")).sort();
const docs = files.map((f) => {
  const text = readFileSync(join(SEED, f), "utf8");
  const header = text.slice(0, text.indexOf("# QUESTION"));
  const parsed = parsePlainText(text);
  if (parsed.errors.length) throw new Error(`${f}: ${parsed.errors[0].message}`);
  return { f, header, questions: parsed.questions };
});
const find = (id: string) => {
  for (const d of docs) {
    const i = d.questions.findIndex((q) => q.id === id);
    if (i >= 0) return { d, i };
  }
  throw new Error(`No question ${id}`);
};

// Split the patch into "@ id" edit blocks and "# QUESTION" replacement blocks.
const chunks: string[] = [];
for (const line of patchText.split("\n")) {
  if (line.startsWith("@") || line.startsWith("# QUESTION")) chunks.push("");
  if (chunks.length) chunks[chunks.length - 1] += line + "\n";
}

// Whole-question replacements.
const replaced = parsePlainText(chunks.filter((c) => c.startsWith("# QUESTION")).join("\n"));
if (replaced.errors.length) throw new Error(`patch: line ${replaced.errors[0].line}: ${replaced.errors[0].message}`);
for (const q of replaced.questions) {
  const { d, i } = find(q.id!);
  d.questions[i] = q;
  console.log(`${q.id}: replaced -> ${q.prompt} (${q.answers.length} answers)`);
}

// Incremental edits.
for (const block of chunks.filter((c) => c.startsWith("@"))) {
  const lines = block.split("\n");
  const id = lines[0].slice(1).trim();
  if (!/^q\d+$/.test(id)) continue;
  const { d, i } = find(id);
  const q: ParsedQuestion = d.questions[i];
  let section: TierPoints | "na" | "remove" | "alias" | null = null;
  let added = 0, skipped: string[] = [], removed = 0;
  const keys = () => {
    const m = new Map<string, number>();
    q.answers.forEach((a, n) => [a.text, ...(a.aliases ?? [])].forEach((t) => m.set(normalize(t), n)));
    return m;
  };
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const h = /^\[(.+)\]$/.exec(line);
    if (h) {
      const name = h[1].toLowerCase();
      section = name === "not accepted" ? "na" : name === "remove" ? "remove" : name === "alias" ? "alias" : (tierFromName(name) ?? null);
      if (section === null) throw new Error(`${id}: unknown section ${h[1]}`);
      continue;
    }
    const kv = /^(prompt|note|category):\s*(.+)$/.exec(line);
    if (kv && section === null) {
      (q as unknown as Record<string, string>)[kv[1]] = kv[2];
      continue;
    }
    if (section === "remove") {
      // Match the answer's own text only (never an alias), so a removal can't hit the wrong answer.
      const n = q.answers.findIndex((a) => normalize(a.text) === normalize(line));
      if (n < 0) skipped.push(`(remove missing) ${line}`);
      else {
        q.answers.splice(n, 1);
        removed++;
      }
      continue;
    }
    if (section === "alias") {
      // "Existing answer | new alias | ..." adds spellings to an answer that's already there.
      const [target, ...extra] = line.split("|").map((x) => x.trim()).filter(Boolean);
      const k = keys();
      const n = k.get(normalize(target));
      if (n === undefined) {
        skipped.push(`(alias target missing) ${target}`);
        continue;
      }
      const a = q.answers[n];
      for (const x of extra) {
        if (k.has(normalize(x))) continue;
        a.aliases = [...(a.aliases ?? []), x];
        k.set(normalize(x), n);
      }
      continue;
    }
    if (section === "na") {
      if (keys().has(normalize(line))) skipped.push(`(NA is an answer) ${line}`);
      else if (!q.nearMisses.some((x) => normalize(x) === normalize(line))) q.nearMisses.push(line);
      continue;
    }
    const [text, ...aliases] = line.split("|").map((s) => s.trim()).filter(Boolean);
    const k = keys();
    if (k.has(normalize(text))) {
      skipped.push(text);
      continue;
    }
    const seen = new Set<string>([normalize(text)]);
    const keep = aliases.filter((a) => {
      const n = normalize(a);
      if (k.has(n) || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    q.answers.push({ text, tier: section!, ...(keep.length ? { aliases: keep } : {}) });
    q.nearMisses = q.nearMisses.filter((x) => !seen.has(normalize(x)));
    added++;
  }
  console.log(`${id}: +${added}${removed ? ` -${removed}` : ""} -> ${q.answers.length} answers${skipped.length ? ` (skipped: ${skipped.join("; ")})` : ""}`);
}

for (const d of docs) writeFileSync(join(SEED, d.f), d.header + serializeQuestions(d.questions));
