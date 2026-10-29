-- Fathom D1 schema.
-- Each question's answers/aliases/near-misses live in one JSON column
-- (questions.data) instead of separate rows. That keeps a whole week's import
-- to ~150 row writes, well inside D1's free-tier write limits.

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  prompt_key TEXT NOT NULL,               -- normalized prompt, for duplicate checks
  category TEXT NOT NULL,
  status TEXT NOT NULL,                   -- reserve | scheduled | unlimited | retired
  daily_date TEXT,                        -- YYYY-MM-DD when scheduled for a Daily
  daily_slot INTEGER,                     -- 1..7
  source TEXT NOT NULL DEFAULT 'seed',    -- seed | weekly | paste
  data TEXT NOT NULL,                     -- JSON: { answers: [{id,text,aliases,tier}], nearMisses, notes }
  answer_count INTEGER NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  retired_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_prompt_key ON questions(prompt_key);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_daily ON questions(daily_date, daily_slot);

CREATE TABLE IF NOT EXISTS daily_sets (
  date TEXT PRIMARY KEY,
  question_ids TEXT NOT NULL,             -- JSON array, slot order
  status TEXT NOT NULL DEFAULT 'locked'   -- locked once anyone has played it
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  nickname TEXT,
  friend_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_friend_code ON players(friend_code);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,                     -- daily | unlimited
  date TEXT,                              -- daily date, null for unlimited
  question_ids TEXT NOT NULL,             -- JSON array
  current_index INTEGER NOT NULL DEFAULT -1,
  question_started_at INTEGER NOT NULL DEFAULT 0,
  penalties INTEGER NOT NULL DEFAULT 0,
  current_done INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_daily ON sessions(player_id, date) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

CREATE TABLE IF NOT EXISTS plays (
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  answer_id TEXT,
  canonical TEXT,
  tier INTEGER,
  points INTEGER NOT NULL,
  ms_used INTEGER NOT NULL,
  corrected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_plays_question ON plays(question_id);

CREATE TABLE IF NOT EXISTS daily_results (
  player_id TEXT NOT NULL,
  date TEXT NOT NULL,
  points INTEGER NOT NULL,
  tiers TEXT NOT NULL,                    -- JSON array of tier points or null
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_results_date ON daily_results(date);

CREATE TABLE IF NOT EXISTS seen (
  player_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, question_id)
);

CREATE TABLE IF NOT EXISTS rejected_guesses (
  question_id TEXT NOT NULL,
  normalized TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  closest_answer_id TEXT,
  distance INTEGER,
  last_seen INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, normalized)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  guess TEXT NOT NULL,
  player_id TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'     -- open | resolved
);

CREATE TABLE IF NOT EXISTS answer_stats (
  answer_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  times_chosen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_answer_stats_question ON answer_stats(question_id);

CREATE TABLE IF NOT EXISTS friends (
  player_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, friend_id)
);
