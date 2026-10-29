/**
 * npm run export:rejected [-- --local]
 * Downloads rejected guesses (seen 2+ times) and "this should count" reports,
 * formatted for Claude to turn into FIXES blocks. Prints it and saves a copy
 * to content/incoming/rejected-<date>.txt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminFetch } from "./lib/admin-client";
import { ROOT } from "./lib/content";

const text = await adminFetch<string>("/api/admin/rejected-export", { text: true });
const dir = join(ROOT, "content", "incoming");
mkdirSync(dir, { recursive: true });
const file = join(dir, `rejected-${new Date().toISOString().slice(0, 10)}.txt`);
writeFileSync(file, text);
console.log(text);
console.log(`(Saved to ${file})`);
