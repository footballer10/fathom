/**
 * npm run status [-- --local]
 * Prints what the weekly task needs: next open dates, existing prompts,
 * category usage, and the Unlimited pool size. Also caches the prompt list
 * and schedule in content/.status.json so `validate:questions` can catch duplicates.
 */
import { writeFileSync } from "node:fs";
import { adminFetch } from "./lib/admin-client";
import { STATUS_CACHE } from "./lib/content";

interface Status {
  today: string;
  bufferDays: number;
  filledDaysAhead: number;
  openDates: { date: string; openSlots: number[] }[];
  poolSize: number;
  poolCap: number;
  reserveCount: number;
  retiredCount: number;
  totalQuestions: number;
  categoryUsage: Record<string, number>;
  prompts: { id: string; prompt: string; category: string; status: string }[];
  scheduled: { id: string; date: string; slot: number }[];
}

const s = await adminFetch<Status>("/api/admin/status");
writeFileSync(STATUS_CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), prompts: s.prompts, scheduled: s.scheduled }, null, 2));

const weekNeeded = s.filledDaysAhead < s.bufferDays;
console.log(`Today (Daily time zone): ${s.today}`);
console.log(`Days fully scheduled ahead: ${s.filledDaysAhead} (target buffer: ${s.bufferDays})${weekNeeded ? "  <-- needs more" : ""}`);
console.log(`\nNext open dates (date: open slots):`);
for (const d of s.openDates.slice(0, 14)) console.log(`  ${d.date}: ${d.openSlots.join(", ")}`);
console.log(`\nUnlimited pool: ${s.poolSize} active (cap ${s.poolCap}), ${s.reserveCount} reserve, ${s.retiredCount} retired, ${s.totalQuestions} total`);
console.log(`\nCategory usage (Dailies, last 4 weeks + scheduled):`);
for (const [c, n] of Object.entries(s.categoryUsage).sort((a, b) => a[1] - b[1])) console.log(`  ${c.padEnd(18)} ${n}`);
console.log(`\nExisting prompts (${s.prompts.length}):`);
for (const p of s.prompts) console.log(`  ${p.id}  ${p.prompt}`);
console.log(`\n(Saved prompt list for duplicate checks to content/.status.json)`);
