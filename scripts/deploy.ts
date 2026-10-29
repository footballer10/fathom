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
let out = "";
try {
  out = wrangler(["deploy"], { capture: true });
} catch {
  console.error(`
Deploy didn't finish. The most common reason on a new Cloudflare account:
you haven't picked your free workers.dev address yet.

  1. Open https://dash.cloudflare.com and log in.
  2. Click "Workers & Pages" in the left menu (Compute, then Workers & Pages on some accounts).
  3. If it asks you to choose a subdomain, type a short name (e.g. your-name) and confirm.
  4. Wait a minute, then run: npm run deploy
`);
  process.exit(1);
}
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
