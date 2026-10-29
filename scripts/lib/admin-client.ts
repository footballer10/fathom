import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./content";

/**
 * Talks to the admin API. Reads SITE_URL and ADMIN_TOKEN from environment variables
 * or from .env.local (never printed). Pass --local to use your `npm run dev` server instead.
 */
export function adminConfig(argv = process.argv): { base: string; token: string } {
  if (argv.includes("--local")) {
    const vars = join(ROOT, "worker", ".dev.vars");
    const token = existsSync(vars) ? readFileSync(vars, "utf8").match(/^ADMIN_TOKEN=(.+)$/m)?.[1].trim() : undefined;
    return { base: "http://127.0.0.1:8787", token: token ?? "dev-admin-token" };
  }
  // Cloud runs have no .env.local; they get the same two values as environment variables.
  if (process.env.SITE_URL && process.env.ADMIN_TOKEN) {
    return { base: process.env.SITE_URL.trim().replace(/\/+$/, ""), token: process.env.ADMIN_TOKEN.trim() };
  }
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) {
    console.error("Missing .env.local. Copy .env.example to .env.local and fill in SITE_URL and ADMIN_TOKEN.");
    process.exit(1);
  }
  const text = readFileSync(envPath, "utf8");
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
  const base = get("SITE_URL")?.replace(/\/+$/, "");
  const token = get("ADMIN_TOKEN");
  if (!base || base.includes("your-site") || !token || token.includes("replace-with")) {
    console.error("Fill in SITE_URL and ADMIN_TOKEN in .env.local first.");
    process.exit(1);
  }
  return { base, token };
}

export async function adminFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; text?: boolean } = {},
  argv = process.argv,
): Promise<T> {
  const { base, token } = adminConfig(argv);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(base + path, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (res.status >= 500 && attempt < 2) throw new Error(`HTTP ${res.status}`);
      const payload = init.text ? await res.text() : await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 422) {
        const msg = typeof payload === "object" && payload && "error" in payload ? (payload as { error: string }).error : `HTTP ${res.status}`;
        throw Object.assign(new Error(msg), { fatal: res.status === 401 || res.status === 404 });
      }
      return payload as T;
    } catch (err) {
      lastErr = err;
      if ((err as { fatal?: boolean }).fatal) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastErr;
}
