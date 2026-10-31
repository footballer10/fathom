-- Friend requests sent from the leaderboards, and player suggestions.
-- The worker also creates these at runtime (CREATE TABLE IF NOT EXISTS), so
-- applying this file is only needed for local tooling.
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id, status);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT,
  nickname TEXT,
  kind TEXT NOT NULL,                       -- answer | bug | idea | other
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'       -- open | reviewed
);
