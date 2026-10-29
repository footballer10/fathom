/**
 * npm run dev: the whole game on your computer, no Cloudflare account needed.
 *  - seeds a local database the first time (or when you run `npm run seed`)
 *  - runs the Worker (API + rooms) on :8787 and the website on :5173
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/content";
import { WORKER_DIR } from "./lib/wrangler";

const run = (cmd: string, args: string[], cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// The Worker serves web/dist in production; in dev Vite serves the site, but the folder must exist.
const dist = join(ROOT, "web", "dist");
if (!existsSync(join(dist, "index.html"))) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Dev</title><p>Open http://localhost:5173 for the dev site.</p>");
}

// Local admin token for the /admin portal (only used on your computer).
const devVars = join(WORKER_DIR, ".dev.vars");
if (!existsSync(devVars)) {
  let token = "dev-admin-token";
  const envLocal = join(ROOT, ".env.local");
  if (existsSync(envLocal)) {
    const m = readFileSync(envLocal, "utf8").match(/^ADMIN_TOKEN=(.+)$/m);
    if (m && !m[1].includes("replace-with")) token = m[1].trim();
  }
  writeFileSync(devVars, `ADMIN_TOKEN=${token}\n`);
}

if (!existsSync(join(WORKER_DIR, ".wrangler", "seed", ".seeded-local"))) {
  console.log("First run: setting up your local database...\n");
  run("npx", ["tsx", "scripts/seed.ts", "--local"]);
}

console.log("\nStarting the game. Open http://localhost:5173 (press Ctrl+C to stop).\n");
const procs = [
  spawn("npx", ["wrangler", "dev", "--port", "8787", "--log-level", "warn"], { cwd: WORKER_DIR, stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npx", ["vite", "--port", "5173", "--strictPort"], { cwd: join(ROOT, "web"), stdio: "inherit", shell: process.platform === "win32" }),
];
const stop = () => {
  for (const p of procs) p.kill("SIGINT");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && code !== 0 && stop());
