/**
 * npm run remove -- q0123 q0456 [--local]
 * Takes questions off the live site. A question nobody has played yet is
 * deleted; one that has been played (or already aired as a Daily) is retired,
 * so old scores still point at it. Empty Daily slots are refilled by the
 * weekly task (and filled from reserve automatically if a day comes up empty).
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
    const r = await adminFetch<{ ok: boolean; deleted?: boolean; retired?: boolean }>(`/api/admin/question/${encodeURIComponent(id)}`, { method: "DELETE" });
    console.log(`  ${id}: ${r.deleted ? "deleted" : r.retired ? "retired" : "done"}`);
  } catch (err) {
    failures++;
    console.log(`  ${id}: failed (${(err as Error).message})`);
  }
}
if (failures) process.exit(1);
