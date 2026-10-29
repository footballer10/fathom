/**
 * npm run setup: one-time setup of your free Cloudflare account.
 *  1. Logs you in to Cloudflare (opens your browser) if needed
 *  2. Creates the D1 database and KV namespace (or finds them if they exist)
 *  3. Writes their IDs into worker/wrangler.jsonc
 *  4. Creates the tables and loads the 150-question seed bank
 * Safe to run more than once.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { WORKER_DIR, wrangler } from "./lib/wrangler";
import { ROOT } from "./lib/content";

function loggedIn(): boolean {
  try {
    const out = wrangler(["whoami"], { capture: true });
    return !/not authenticated|You are not authenticated/i.test(out);
  } catch {
    return false;
  }
}

console.log("Step 1/4: Cloudflare login");
if (!loggedIn()) {
  console.log("A browser window will open. Log in to Cloudflare (or create a free account) and click Allow.\n");
  wrangler(["login"]);
}

console.log("\nStep 2/4: database and key-value storage");
const findD1 = () => {
  const list = JSON.parse(wrangler(["d1", "list", "--json"], { capture: true })) as { name: string; uuid: string }[];
  return list.find((d) => d.name === "krillion")?.uuid;
};
let d1 = findD1();
if (!d1) {
  wrangler(["d1", "create", "krillion"], { capture: true });
  d1 = findD1();
}
if (!d1) throw new Error("Couldn't create the D1 database");
console.log(`  D1 database: krillion (${d1})`);

const findKv = () => {
  const list = JSON.parse(wrangler(["kv", "namespace", "list"], { capture: true })) as { id: string; title: string }[];
  return list.find((n) => n.title === "krillion-unlimited-KV" || n.title === "krillion-kv" || n.title.endsWith("krillion-kv"))?.id;
};
let kv = findKv();
if (!kv) {
  wrangler(["kv", "namespace", "create", "krillion-kv"], { capture: true });
  kv = findKv();
}
if (!kv) throw new Error("Couldn't create the KV namespace");
console.log(`  KV namespace: krillion-kv (${kv})`);

console.log("\nStep 3/4: saving IDs to worker/wrangler.jsonc");
const cfgPath = join(WORKER_DIR, "wrangler.jsonc");
let cfg = readFileSync(cfgPath, "utf8");
cfg = cfg.replace(/"database_id": "[^"]*"/, `"database_id": "${d1}"`).replace(/("binding": "KV",\s*"id": )"[^"]*"/, `$1"${kv}"`);
writeFileSync(cfgPath, cfg);

console.log("\nStep 4/4: creating tables and loading the seed bank (this takes a minute)");
const r = spawnSync("npx", ["tsx", "scripts/seed.ts", "--remote"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) process.exit(r.status ?? 1);

console.log(`
Setup complete!

Next:
  1. Set your admin password on Cloudflare (it will ask you to type it):
       cd worker && npx wrangler secret put ADMIN_TOKEN && cd ..
  2. Put the same password in .env.local (see .env.example).
  3. Deploy:  npm run deploy
`);
