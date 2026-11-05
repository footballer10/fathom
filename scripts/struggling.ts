/**
 * npm run struggling [-- --days 21 --min 15]
 * Lists the questions players struggle with most: recent Dailies and Unlimited
 * questions with the lowest success rates (at least --min plays). Saves the list
 * to content/incoming/struggling-<date>.txt for the weekly task to review.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminFetch } from "./lib/admin-client";
import { ROOT } from "./lib/content";

const argv = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
type Row = { id: string; prompt: string; category: string; dailyDate?: string | null; status?: string; plays: number; successRate: number; avgPoints: number };
const r = await adminFetch<{ days: number; minPlays: number; recentDailies: Row[]; allQuestions: Row[] }>(
  `/api/admin/struggling?days=${opt("days", 21)}&min=${opt("min", 15)}`,
);
const line = (q: Row) => `${q.id}  ${String(q.successRate).padStart(3)}% success  ${String(q.avgPoints).padStart(3)} avg pts  ${String(q.plays).padStart(4)} plays  ${q.dailyDate ? `Daily ${q.dailyDate}  ` : ""}${q.prompt}`;
const text = [
  `Questions players struggle with (at least ${r.minPlays} plays). Success = share of plays with an accepted answer.`,
  "",
  `RECENT DAILIES (last ${r.days} days), worst first:`,
  ...(r.recentDailies.length ? r.recentDailies.map(line) : ["(none with enough plays)"]),
  "",
  "ALL ACTIVE QUESTIONS (Unlimited and aired Dailies), worst first:",
  ...(r.allQuestions.length ? r.allQuestions.map(line) : ["(none with enough plays)"]),
  "",
].join("\n");
const dir = join(ROOT, "content", "incoming");
mkdirSync(dir, { recursive: true });
const file = join(dir, `struggling-${new Date().toISOString().slice(0, 10)}.txt`);
writeFileSync(file, text);
console.log(text);
console.log(`Saved to ${file}`);
