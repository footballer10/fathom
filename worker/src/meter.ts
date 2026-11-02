/**
 * Dev-only database meter. On local hostnames every request's D1 calls are
 * counted and the totals come back as `X-D1-Rows-Read` / `X-D1-Rows-Written`
 * headers, so `npm run sim:rows` can show what each endpoint costs against the
 * free tier (5M rows read and 100k rows written per day). Never used in production.
 */
export type Tally = { read: number; written: number };

type Meta = { rows_read?: number; rows_written?: number } | undefined;

export function meterDb(db: D1Database, tally: Tally): D1Database {
  const add = (meta: Meta) => {
    tally.read += meta?.rows_read ?? 0;
    tally.written += meta?.rows_written ?? 0;
  };
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const w = Object.create(stmt) as D1PreparedStatement & { __raw: D1PreparedStatement };
    w.__raw = stmt;
    w.bind = (...args: unknown[]) => wrap(stmt.bind(...args));
    w.all = (async () => {
      const r = await stmt.all();
      add(r.meta as Meta);
      return r;
    }) as D1PreparedStatement["all"];
    w.run = (async () => {
      const r = await stmt.run();
      add(r.meta as Meta);
      return r;
    }) as D1PreparedStatement["run"];
    w.first = (async (col?: string) => {
      const r = await stmt.all<Record<string, unknown>>();
      add(r.meta as Meta);
      const row = r.results[0] ?? null;
      return col ? (row?.[col] ?? null) : row;
    }) as D1PreparedStatement["first"];
    return w;
  };
  const metered = Object.create(db) as D1Database;
  metered.prepare = (sql: string) => wrap(db.prepare(sql));
  metered.batch = (async (stmts: D1PreparedStatement[]) => {
    const rs = await db.batch(stmts.map((s) => (s as D1PreparedStatement & { __raw?: D1PreparedStatement }).__raw ?? s));
    for (const r of rs) add(r.meta as Meta);
    return rs;
  }) as D1Database["batch"];
  return metered;
}

export const isLocalHost = (url: string) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname);
