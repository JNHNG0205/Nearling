-- Nearling Run results (AI-brain architectual/06-race-arena.md section 4). Owned by the race area.
-- Rooms and tokens live in memory; only finished and interrupted matches are stored.
CREATE TABLE match (
  id            TEXT PRIMARY KEY,
  room_code     TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  seed          INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,  -- start_at, server ms
  ended_at      INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('finished', 'interrupted')),
  winner_slot   INTEGER CHECK (winner_slot IN (0, 1)),  -- NULL = draw or interrupted
  reason        TEXT NOT NULL  -- crash | same_tick | time | disconnect
);

CREATE TABLE match_player (
  match_id      TEXT NOT NULL REFERENCES match (id),
  slot          INTEGER NOT NULL CHECK (slot IN (0, 1)),
  kind          TEXT NOT NULL CHECK (kind IN ('browser', 'device')),
  name          TEXT NOT NULL,
  pet_ref       TEXT,
  reported_tick INTEGER,  -- what the client claimed (NULL = still alive or no report)
  crash_tick    INTEGER,  -- what the server accepted after replay (NULL = survived)
  report_valid  INTEGER,  -- 1 matched the replay, 0 replaced by the server's replay, NULL no verdict
  PRIMARY KEY (match_id, slot)
);
CREATE INDEX match_player_pet ON match_player (pet_ref);
