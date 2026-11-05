/**
 * npm run remove -- q0123 q0456 [--local]
 * Deletes questions from the live site for good: they're never used in a Daily,
 * Unlimited or reserve again, and pool refresh never brings them back (the row
 * is kept so old scores still point at it). If one was an upcoming Daily, every
 * later Daily question slides up a slot, and the last slot opens for the weekly
 * task to fill.
 */
import { adminFetch } from "./lib/admin-client";

const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!ids.length) {
  console.error("Usage: npm run remove -- <question id> [more ids]");
  process.exit(1);
}
let failures = 0;
for (const id of ids) {
  try {
    const r = await adminFetch<{ ok: boolean; deleted?: boolean; moved?: number }>(`/api/admin/question/${encodeURIComponent(id)}`, { method: "DELETE" });
    console.log(`  ${id}: deleted${r.moved ? ` (${r.moved} later Daily question(s) slid up)` : ""}`);
  } catch (err) {
    failures++;
    console.log(`  ${id}: failed (${(err as Error).message})`);
  }
}
if (failures) process.exit(1);
