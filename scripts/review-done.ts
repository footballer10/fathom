/**
 * npm run review:done [-- --local]
 * After the learning loop: marks every report and rejected guess that was in
 * this week's export as reviewed, so next week's export only shows new ones.
 * Uses the time saved by `npm run export:rejected` (anything newer stays open).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adminFetch } from "./lib/admin-client";
import { ROOT } from "./lib/content";

const stampFile = join(ROOT, "content", "incoming", ".rejected-exported-at");
const before = existsSync(stampFile) ? Number(readFileSync(stampFile, "utf8")) : Date.now();
const res = await adminFetch<{ reports: number; rejected: number }>("/api/admin/review/done", { method: "POST", body: { before } });
console.log(`Marked reviewed: ${res.reports} report(s), ${res.rejected} rejected guess group(s).`);
