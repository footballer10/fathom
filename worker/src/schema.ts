import type { Env } from "./env";
import { ensureAbyss, ensureRuns } from "./practice";

/**
 * Summary tables that keep D1 reads small and flat as the site grows.
 *
 * D1's free tier allows 5M rows read a day, and every row a query scans counts,
 * so nothing that runs per request (or every few minutes) may scan a table that
 * grows with history. These tables are kept up to date as games finish, so
 * pages read a handful of rows instead:
 *
 *  - daily_hist:   how many people finished a Daily on each score. Percentile,
 *                  "divers today" and your Daily rank are sums over ~100 rows,
 *                  instead of counting every result that day on every finish.
 *  - daily_rarest: the rarest answer given on each Daily (one row per day).
 *  - lb_stats:     one row per player with everything the global leaderboards
 *                  rank by, so a refresh reads one row per player instead of
 *                  every play ever made.
 *
 * Automatic deploys don't run migrations, so the first request on each server
 * instance checks a version number (one row) and, if it's behind, creates the
 * tables and fills them from the full history once.
 */

const SCHEMA_VERSION = 3;
let ready: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  ready ??= migrate(env).catch((err) => {
    ready = null; // try again on the next request
    throw err;
  });
  return ready;
}

async function migrate(env: Env) {
  const [, version] = await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    env.DB.prepare("SELECT value FROM meta WHERE key = 'schema'"),
  ]);
  const current = Number((version.results[0] as { value?: string } | undefined)?.value ?? 0);
  if (current >= SCHEMA_VERSION) return;
  if (current < 1) await migrateV1(env);
  if (current < 2) {
    // Indexes for the admin portal's Players page (activity in a time window).
    await env.DB.batch([
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_practice_runs_started ON practice_runs(started_at)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_party_results_finished ON party_results(finished_at)"),
      env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '2')"),
    ]);
  }
  if (current < 3) {
    // For the admin portal's cheat flags: exactly what was typed for each accepted
    // answer, and how many wrong guesses each dive had.
    await env.DB.prepare("ALTER TABLE plays ADD COLUMN typed TEXT").run().catch(() => {});
    await env.DB.prepare("ALTER TABLE sessions ADD COLUMN wrongs INTEGER NOT NULL DEFAULT 0").run().catch(() => {});
    // Typed text and wrong guesses only exist from now on; the flags only use dives after this.
    await env.DB.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('cheat_tracking_since', ?)").bind(String(Date.now())).run();
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '3')").run();
  }
}

/** Version 1: the summary tables, filled from the full history once. */
async function migrateV1(env: Env) {

  await Promise.all([ensureRuns(env), ensureAbyss(env), ensurePartyResults(env)]);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS daily_hist (date TEXT NOT NULL, points INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (date, points))"),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS daily_rarest (
         date TEXT PRIMARY KEY, tier INTEGER NOT NULL, canonical TEXT NOT NULL, question_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS lb_stats (
         player_id TEXT PRIMARY KEY,
         d_dives INTEGER NOT NULL DEFAULT 0, d_n INTEGER NOT NULL DEFAULT 0, d_k INTEGER NOT NULL DEFAULT 0,
         d_rare INTEGER NOT NULL DEFAULT 0, d_pts INTEGER NOT NULL DEFAULT 0, d_best INTEGER NOT NULL DEFAULT 0,
         u_dives INTEGER NOT NULL DEFAULT 0, u_n INTEGER NOT NULL DEFAULT 0, u_k INTEGER NOT NULL DEFAULT 0,
         u_dc INTEGER NOT NULL DEFAULT 0, u_rare INTEGER NOT NULL DEFAULT 0, u_ans INTEGER NOT NULL DEFAULT 0,
         u_pts INTEGER NOT NULL DEFAULT 0, u_best INTEGER NOT NULL DEFAULT 0,
         streak_cur INTEGER NOT NULL DEFAULT 0, streak_best INTEGER NOT NULL DEFAULT 0, streak_last TEXT,
         p_games INTEGER NOT NULL DEFAULT 0, p_wins INTEGER NOT NULL DEFAULT 0,
         w_dive INTEGER NOT NULL DEFAULT 0, w_battle INTEGER NOT NULL DEFAULT 0, w_shark INTEGER NOT NULL DEFAULT 0,
         w_relay INTEGER NOT NULL DEFAULT 0, w_hotpotato INTEGER NOT NULL DEFAULT 0, w_school INTEGER NOT NULL DEFAULT 0,
         w_coop INTEGER NOT NULL DEFAULT 0,
         best_sprint INTEGER NOT NULL DEFAULT 0, best_ladder INTEGER NOT NULL DEFAULT 0,
         best_roulette INTEGER NOT NULL DEFAULT 0, best_five INTEGER NOT NULL DEFAULT 0,
         abyss_k INTEGER NOT NULL DEFAULT 0)`,
    ),
    // Daily top 10 straight off an index (reads ~10 rows, not the whole day).
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_daily_results_top ON daily_results(date, points DESC, created_at)"),
    // Abyss top 10 the same way.
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_abyss_top ON abyss_attempts(week, best_tier DESC, (best_at - started_at))"),
  ]);
  await env.DB.prepare("ALTER TABLE abyss_weeks ADD COLUMN divers INTEGER").run().catch(() => {});

  // Fill everything from the full history, in one transaction, so it's exact.
  // (Running twice gives the same result, so two instances racing here is harmless.)
  await env.DB.batch([
    env.DB.prepare("DELETE FROM daily_hist"),
    env.DB.prepare("INSERT INTO daily_hist (date, points, n) SELECT date, points, COUNT(*) FROM daily_results GROUP BY date, points"),
    env.DB.prepare("DELETE FROM daily_rarest"),
    env.DB.prepare(
      `INSERT OR IGNORE INTO daily_rarest (date, tier, canonical, question_id, created_at)
       SELECT s.date, p.tier, p.canonical, p.question_id, p.created_at FROM plays p JOIN sessions s ON s.id = p.session_id
       WHERE s.mode = 'daily' AND s.date IS NOT NULL AND p.tier IS NOT NULL AND p.canonical IS NOT NULL
       ORDER BY s.date, p.tier DESC, p.created_at ASC`,
    ),
    ...lbStatsStatements(env),
    env.DB.prepare("UPDATE abyss_weeks SET divers = (SELECT COUNT(*) FROM abyss_attempts a WHERE a.week = abyss_weeks.week)"),
    env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', '1')"),
  ]);
}

// party_results arrived after launch; make sure it (and its variant column) exist.
let partyReady = false;
export async function ensurePartyResults(env: Env) {
  if (partyReady) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS party_results (
         id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, room TEXT NOT NULL, player_id TEXT NOT NULL,
         rank INTEGER NOT NULL, player_count INTEGER NOT NULL, score INTEGER NOT NULL, finished_at INTEGER NOT NULL)`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_party_results_player ON party_results(player_id)"),
  ]);
  await env.DB.prepare("ALTER TABLE party_results ADD COLUMN variant TEXT NOT NULL DEFAULT 'classic'").run().catch(() => {});
  partyReady = true;
}

// ---------------------------------------------------------------------------
// Keeping the summaries up to date (a few row writes per finished game)
// ---------------------------------------------------------------------------

/** The day before a YYYY-MM-DD date. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** A finished Daily or Unlimited dive. `plays` are its answered (or missed) prompts. */
export function soloFinishStatements(
  env: Env,
  playerId: string,
  mode: "daily" | "unlimited",
  date: string | null,
  plays: { tier: number | null; answer_id: string | null; points: number; canonical: string | null; question_id: string; created_at?: number }[],
  now: number,
): D1PreparedStatement[] {
  if (!plays.length) return [];
  const n = plays.length;
  const k = plays.filter((p) => p.tier === 100).length;
  const dc = plays.filter((p) => p.tier === 85).length;
  const rare = plays.filter((p) => (p.tier ?? 0) >= 85).length;
  const ans = plays.filter((p) => p.answer_id).length;
  const pts = plays.reduce((s, p) => s + p.points, 0);
  const out: D1PreparedStatement[] = [];
  if (mode === "daily" && date) {
    out.push(
      env.DB.prepare(
        `INSERT INTO lb_stats (player_id, d_dives, d_n, d_k, d_rare, d_pts, d_best, streak_cur, streak_best, streak_last) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?5, 1, 1, ?6)
         ON CONFLICT(player_id) DO UPDATE SET d_dives = d_dives + 1, d_n = d_n + ?2, d_k = d_k + ?3, d_rare = d_rare + ?4, d_pts = d_pts + ?5,
           d_best = MAX(d_best, ?5),
           streak_cur = CASE WHEN streak_last = ?7 THEN streak_cur + 1 WHEN streak_last = ?6 THEN streak_cur ELSE 1 END,
           streak_best = MAX(streak_best, CASE WHEN streak_last = ?7 THEN streak_cur + 1 WHEN streak_last = ?6 THEN streak_cur ELSE 1 END),
           streak_last = ?6`,
      ).bind(playerId, n, k, rare, pts, date, dayBefore(date)),
      env.DB.prepare("INSERT INTO daily_hist (date, points, n) VALUES (?, ?, 1) ON CONFLICT(date, points) DO UPDATE SET n = n + 1").bind(date, pts),
    );
    const top = plays.filter((p) => p.tier && p.canonical).sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0];
    if (top) {
      out.push(
        env.DB.prepare(
          `INSERT INTO daily_rarest (date, tier, canonical, question_id, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET tier = excluded.tier, canonical = excluded.canonical, question_id = excluded.question_id, created_at = excluded.created_at
           WHERE excluded.tier > daily_rarest.tier`,
        ).bind(date, top.tier, top.canonical, top.question_id, top.created_at ?? now),
      );
    }
  } else if (mode === "unlimited") {
    out.push(
      env.DB.prepare(
        `INSERT INTO lb_stats (player_id, u_dives, u_n, u_k, u_dc, u_rare, u_ans, u_pts, u_best) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(player_id) DO UPDATE SET u_dives = u_dives + 1, u_n = u_n + ?2, u_k = u_k + ?3, u_dc = u_dc + ?4, u_rare = u_rare + ?5,
           u_ans = u_ans + ?6, u_pts = u_pts + ?7, u_best = MAX(u_best, ?7)`,
      ).bind(playerId, n, k, dc, rare, ans, pts),
    );
  }
  return out;
}

const WIN_COLUMN: Record<string, string> = {
  "dive:classic": "w_dive",
  "battle:classic": "w_battle",
  "dive:shark": "w_shark",
  "battle:relay": "w_relay",
  "battle:hotpotato": "w_hotpotato",
  "dive:school": "w_school",
  "dive:coop": "w_coop",
};

/** One player's result in a finished party game. */
export function partyResultStatement(env: Env, playerId: string, kind: string, variant: string, won: boolean): D1PreparedStatement {
  const col = WIN_COLUMN[`${kind}:${variant}`];
  const w = won ? 1 : 0;
  return env.DB.prepare(
    `INSERT INTO lb_stats (player_id, p_games, p_wins${col ? `, ${col}` : ""}) VALUES (?1, 1, ?2${col ? ", ?2" : ""})
     ON CONFLICT(player_id) DO UPDATE SET p_games = p_games + 1, p_wins = p_wins + ?2${col ? `, ${col} = ${col} + ?2` : ""}`,
  ).bind(playerId, w);
}

const BEST_COLUMN: Record<string, string> = { sprint: "best_sprint", ladder: "best_ladder", roulette: "best_roulette", five: "best_five" };

/** A finished quick-mode run. */
export function practiceBestStatement(env: Env, playerId: string, mode: string, score: number): D1PreparedStatement | null {
  const col = BEST_COLUMN[mode];
  if (!col) return null;
  return env.DB.prepare(`INSERT INTO lb_stats (player_id, ${col}) VALUES (?1, ?2) ON CONFLICT(player_id) DO UPDATE SET ${col} = MAX(${col}, ?2)`).bind(
    playerId,
    score,
  );
}

/** A player's Abyss answer just became a One in a Krillion for the first time this week. */
export function abyssKrillionStatement(env: Env, playerId: string): D1PreparedStatement {
  return env.DB.prepare("INSERT INTO lb_stats (player_id, abyss_k) VALUES (?, 1) ON CONFLICT(player_id) DO UPDATE SET abyss_k = abyss_k + 1").bind(playerId);
}

/**
 * Rebuild lb_stats from the full history: for everyone (no player id), or for
 * one player (after the admin portal removes one of their dives).
 */
export function lbStatsStatements(env: Env, playerId?: string): D1PreparedStatement[] {
  // With a player id, every query is limited to that player (bound as ?1).
  const only = (col: string) => (playerId ? ` AND ${col} = ?1` : "");
  const prep = (sql: string) => (playerId ? env.DB.prepare(sql).bind(playerId) : env.DB.prepare(sql));
  const SOLO = `SELECT s.player_id, s.mode, COUNT(*) AS n, SUM(pl.tier = 100) AS k, SUM(pl.tier = 85) AS dc, SUM(pl.tier >= 85) AS rare,
                       SUM(pl.answer_id IS NOT NULL) AS ans, SUM(pl.points) AS pts
                FROM sessions s JOIN plays pl ON pl.session_id = s.id
                WHERE s.finished = 1 AND s.mode IN ('daily', 'unlimited')${only("s.player_id")} GROUP BY s.id`;
  const win = (kind: string, variant: string) => `SUM(rank = 1 AND kind = '${kind}' AND COALESCE(variant, 'classic') = '${variant}')`;
  const best = (mode: string) => `MAX(CASE WHEN mode = '${mode}' THEN score END)`;
  return [
    prep(`DELETE FROM lb_stats WHERE true${only("player_id")}`),
    prep(
      `INSERT INTO lb_stats (player_id, d_dives, d_n, d_k, d_rare, d_pts, d_best, u_dives, u_n, u_k, u_dc, u_rare, u_ans, u_pts, u_best)
       SELECT player_id,
              SUM(mode = 'daily'), SUM(CASE WHEN mode = 'daily' THEN n ELSE 0 END), SUM(CASE WHEN mode = 'daily' THEN k ELSE 0 END),
              SUM(CASE WHEN mode = 'daily' THEN rare ELSE 0 END), SUM(CASE WHEN mode = 'daily' THEN pts ELSE 0 END),
              COALESCE(MAX(CASE WHEN mode = 'daily' THEN pts END), 0),
              SUM(mode = 'unlimited'), SUM(CASE WHEN mode = 'unlimited' THEN n ELSE 0 END), SUM(CASE WHEN mode = 'unlimited' THEN k ELSE 0 END),
              SUM(CASE WHEN mode = 'unlimited' THEN dc ELSE 0 END), SUM(CASE WHEN mode = 'unlimited' THEN rare ELSE 0 END),
              SUM(CASE WHEN mode = 'unlimited' THEN ans ELSE 0 END), SUM(CASE WHEN mode = 'unlimited' THEN pts ELSE 0 END),
              COALESCE(MAX(CASE WHEN mode = 'unlimited' THEN pts END), 0)
       FROM (${SOLO}) GROUP BY player_id`,
    ),
    prep(
      `WITH g AS (SELECT player_id, date, julianday(date) - ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY date) AS grp FROM daily_results WHERE true${only("player_id")}),
            r AS (SELECT player_id, grp, COUNT(*) AS len, MAX(date) AS last FROM g GROUP BY player_id, grp),
            t AS (SELECT player_id, MAX(len) AS best, MAX(last) AS last FROM r GROUP BY player_id)
       INSERT INTO lb_stats (player_id, streak_best, streak_last, streak_cur)
       SELECT t.player_id, t.best, t.last, (SELECT r.len FROM r WHERE r.player_id = t.player_id AND r.last = t.last) FROM t WHERE true
       ON CONFLICT(player_id) DO UPDATE SET streak_best = excluded.streak_best, streak_last = excluded.streak_last, streak_cur = excluded.streak_cur`,
    ),
    prep(
      `INSERT INTO lb_stats (player_id, p_games, p_wins, w_dive, w_battle, w_shark, w_relay, w_hotpotato, w_school, w_coop)
       SELECT player_id, COUNT(*), SUM(rank = 1), ${win("dive", "classic")}, ${win("battle", "classic")}, ${win("dive", "shark")},
              ${win("battle", "relay")}, ${win("battle", "hotpotato")}, ${win("dive", "school")}, ${win("dive", "coop")}
       FROM party_results WHERE true${only("player_id")} GROUP BY player_id
       ON CONFLICT(player_id) DO UPDATE SET p_games = excluded.p_games, p_wins = excluded.p_wins, w_dive = excluded.w_dive,
         w_battle = excluded.w_battle, w_shark = excluded.w_shark, w_relay = excluded.w_relay, w_hotpotato = excluded.w_hotpotato,
         w_school = excluded.w_school, w_coop = excluded.w_coop`,
    ),
    prep(
      `INSERT INTO lb_stats (player_id, best_sprint, best_ladder, best_roulette, best_five)
       SELECT player_id, COALESCE(${best("sprint")}, 0), COALESCE(${best("ladder")}, 0), COALESCE(${best("roulette")}, 0), COALESCE(${best("five")}, 0)
       FROM practice_runs WHERE finished = 1${only("player_id")} GROUP BY player_id
       ON CONFLICT(player_id) DO UPDATE SET best_sprint = excluded.best_sprint, best_ladder = excluded.best_ladder,
         best_roulette = excluded.best_roulette, best_five = excluded.best_five`,
    ),
    prep(
      `INSERT INTO lb_stats (player_id, abyss_k) SELECT player_id, COUNT(*) FROM abyss_attempts WHERE best_tier = 100${only("player_id")} GROUP BY player_id
       ON CONFLICT(player_id) DO UPDATE SET abyss_k = excluded.abyss_k`,
    ),
  ];
}
