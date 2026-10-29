/**
 * npm run weekly:brief [-- --days 7 --unlimited 100] [--local]
 * Saves the full writing brief for this week's questions (open Daily dates,
 * every rule, the plain-text format, the category spread and every existing
 * prompt) to content/incoming/brief-<date>.txt for the weekly task to follow.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKLY_UNLIMITED_QUESTIONS } from "../shared/src/index";
import { adminFetch } from "./lib/admin-client";
import { ROOT } from "./lib/content";

const argv = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const days = opt("days", 7);
const unlimited = opt("unlimited", WEEKLY_UNLIMITED_QUESTIONS);

const text = await adminFetch<string>(`/api/admin/generate-prompt?days=${days}&unlimited=${unlimited}`, { text: true });
const dir = join(ROOT, "content", "incoming");
mkdirSync(dir, { recursive: true });
const file = join(dir, `brief-${new Date().toISOString().slice(0, 10)}.txt`);
writeFileSync(file, text);
console.log(`Saved the writing brief (${days} day(s) of Dailies + ${unlimited} Unlimited) to ${file}`);
