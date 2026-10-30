-- One row per player per finished party game, for the global leaderboards.
CREATE TABLE IF NOT EXISTS party_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                     -- dive | battle
  room TEXT NOT NULL,
  player_id TEXT NOT NULL,
  rank INTEGER NOT NULL,                  -- 1 = winner
  player_count INTEGER NOT NULL,
  score INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_party_results_player ON party_results(player_id);
