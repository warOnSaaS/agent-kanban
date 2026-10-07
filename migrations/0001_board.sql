-- The board as a wOS suite app. A team's board lives in its GitHub repo once connected (board_settings);
-- until then its files are kept here, one row per file, so the board works with nothing else set up.
CREATE TABLE IF NOT EXISTS board_files (
  team_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (team_id, path)
);

CREATE TABLE IF NOT EXISTS board_settings (
  team_id TEXT PRIMARY KEY,
  name TEXT,
  repo TEXT,
  branch TEXT,
  token_sealed TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
