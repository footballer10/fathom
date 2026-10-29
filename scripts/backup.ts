/**
 * npm run backup [-- --local]
 * Downloads every question on the live site, in the same plain-text format as
 * the seed files, into content/backup/: one file for Dailies (by date), one for
 * Unlimited and reserve, one for retired. The database is the source of truth;
 * this is the copy kept in git, so nothing is lost if the database ever is.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminFetch } from "./lib/admin-client";
import { ROOT } from "./lib/content";

interface Status {
  prompts: { id: string; status: string }[];
}
interface Exported {
  id: string;
  status: string;
  date: string | null;
  slot: number | null;
  text: string;
}

const { prompts } = await adminFetch<Status>("/api/admin/status");
const out: Exported[] = [];
for (const [i, p] of prompts.entries()) {
  out.push(await adminFetch<Exported>(`/api/admin/question/${encodeURIComponent(p.id)}`));
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${prompts.length}`);
}

const dir = join(ROOT, "content", "backup");
mkdirSync(dir, { recursive: true });
const write = (name: string, qs: Exported[], header: string) => {
  writeFileSync(join(dir, name), `# ${header} (${qs.length}), exported ${new Date().toISOString().slice(0, 10)} by npm run backup\n\n${qs.map((q) => q.text.trim()).join("\n\n")}\n`);
};
const byId = (a: Exported, b: Exported) => a.id.localeCompare(b.id);
write(
  "daily.txt",
  out.filter((q) => q.status === "scheduled").sort((a, b) => `${a.date}${a.slot}`.localeCompare(`${b.date}${b.slot}`)),
  "Daily questions by date",
);
write("unlimited.txt", out.filter((q) => q.status === "unlimited" || q.status === "reserve").sort(byId), "Unlimited and reserve questions");
write("retired.txt", out.filter((q) => q.status === "retired").sort(byId), "Retired questions");
console.log(`Backed up ${out.length} questions to content/backup/.`);
