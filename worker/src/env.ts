export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  /** Set with `npx wrangler secret put ADMIN_TOKEN` (and in .dev.vars for local dev). */
  ADMIN_TOKEN?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
