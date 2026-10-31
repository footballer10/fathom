/**
 * npm run suggestions [-- --local]
 *   Downloads open player suggestions to content/incoming/suggestions-<date>.txt
 *   (plus a .ids.json list) for the weekly task to review.
 * npm run suggestions -- --done [--local]
 *   Marks the suggestions in the latest saved list as reviewed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminFetch } from "./lib/admin-client";
import { ROOT } from "./lib/content";

const dir = join(ROOT, "content", "incoming");
mkdirSync(dir, { recursive: true });

if (process.argv.includes("--done")) {
  const lists = readdirSync(dir).filter((f) => /^suggestions-.*\.ids\.json$/.test(f)).sort();
  const latest = lists[lists.length - 1];
  if (!latest) {
    console.log("No saved suggestions list. Run `npm run suggestions` first.");
    process.exit(0);
  }
  const ids = JSON.parse(readFileSync(join(dir, latest), "utf8")) as number[];
  const res = await adminFetch<{ reviewed: number }>("/api/admin/suggestions/reviewed", { method: "POST", body: { ids } });
  console.log(`Marked ${res.reviewed} suggestion(s) reviewed (from ${latest}).`);
} else {
  const { text, ids } = await adminFetch<{ text: string; ids: number[] }>("/api/admin/suggestions");
  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(dir, `suggestions-${stamp}.txt`);
  writeFileSync(file, text);
  writeFileSync(join(dir, `suggestions-${stamp}.ids.json`), JSON.stringify(ids));
  console.log(text);
  console.log(`(${ids.length} open suggestion(s). Saved to ${file})`);
  if (existsSync(file) && !ids.length) console.log("Nothing to review this week.");
}
