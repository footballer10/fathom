/**
 * npm run pool:refresh [-- --local]
 * Keeps the active Unlimited pool at the cap (UNLIMITED_POOL_CAP in
 * shared/src/config.ts) by retiring the oldest, most-played questions.
 * Retired questions are kept, never deleted, and rotate back in later.
 */
import { adminFetch } from "./lib/admin-client";

const r = await adminFetch<{ before: number; retired: number; restored: number; after: number; cap: number }>("/api/admin/pool-refresh", {
  method: "POST",
  body: {},
});
console.log(`Unlimited pool: ${r.before} → ${r.after} (cap ${r.cap}). Retired ${r.retired}, restored ${r.restored}.`);
