/**
 * npm run deploy: build the website and publish everything (site + API +
 * party rooms) as one Cloudflare Worker. Runs any new database migrations first.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/content";
import { WORKER_DIR, wrangler } from "./lib/wrangler";

const cfg = readFileSync(join(WORKER_DIR, "wrangler.jsonc"), "utf8");
if (cfg.includes('"00000000-0000-0000-0000-000000000000"')) {
  console.error("Run `npm run setup` first (it creates your database and saves its ID).");
  process.exit(1);
}

console.log("Building the website...");
const b = spawnSync("npm", ["run", "build", "-w", "web"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
if (b.status !== 0) process.exit(b.status ?? 1);

console.log("\nApplying database migrations...");
wrangler(["d1", "migrations", "apply", "fathom", "--remote"]);

console.log("\nDeploying...");
const out = wrangler(["deploy"], { capture: true });
process.stdout.write(out);
const url = out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];

try {
  const secrets = wrangler(["secret", "list"], { capture: true });
  if (!secrets.includes("ADMIN_TOKEN")) {
    console.log("\nReminder: the admin portal needs a password. Run:\n  cd worker && npx wrangler secret put ADMIN_TOKEN && cd ..\n");
  }
} catch {
  /* not fatal */
}
console.log(url ? `\nLive at: ${url}\nAdmin portal: ${url}/admin\n` : "\nDeployed.");
