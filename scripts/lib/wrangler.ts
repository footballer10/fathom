import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./content";

export const WORKER_DIR = join(ROOT, "worker");

/** Run a wrangler command inside /worker. Throws if it fails. */
export function wrangler(args: string[], opts: { capture?: boolean; input?: string } = {}): string {
  const res = spawnSync("npx", ["wrangler", ...args], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    stdio: opts.capture || opts.input !== undefined ? ["pipe", "pipe", "inherit"] : "inherit",
    input: opts.input,
    shell: process.platform === "win32",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (res.status !== 0) {
    if (opts.capture && res.stdout) process.stdout.write(res.stdout);
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
  return res.stdout ?? "";
}

export function targetFlag(argv: string[]): "--local" | "--remote" {
  return argv.includes("--remote") ? "--remote" : "--local";
}
