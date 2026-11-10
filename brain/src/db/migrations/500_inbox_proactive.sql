-- Inbox, proactive messages and the public timeline (AI-brain architectual/02, 07).
-- inbox.text_enc is sealed with the pet's key (crypto.ts); never stored in plaintext.
CREATE TABLE inbox (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_ref             TEXT NOT NULL,
  owner_account       TEXT NOT NULL,
  trigger             TEXT NOT NULL,
  text_enc            BLOB NOT NULL,
  turn_id             TEXT,
  created_at          INTEGER NOT NULL,
  delivered_device_at INTEGER,
  read_at             INTEGER
);
CREATE INDEX inbox_pet_owner ON inbox (pet_ref, owner_account, id);

-- Daily cap per pet per UTC day (day = floor(ms / 86400000)); fired = JSON list of triggers sent.
CREATE TABLE proactive_day (
  pet_ref TEXT NOT NULL,
  day     INTEGER NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  fired   TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (pet_ref, day)
);

-- Per-pet memory across days, so a threshold fires once per crossing (not once per day):
-- { latched: trigger[], missed_for: last_owner_turn_at, morning_day: "YYYY-MM-DD", follow_ups: id[] }.
CREATE TABLE proactive_pet (
  pet_ref TEXT PRIMARY KEY,
  state   TEXT NOT NULL DEFAULT '{}'
);

-- Public timeline, filled by the event tail job (timeline/tail.ts). tx_hash is NULL for events
-- detected by diffing get_pet snapshots (SQLite UNIQUE allows many NULLs).
CREATE TABLE pet_event (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_ref  TEXT NOT NULL,
  kind     TEXT NOT NULL,
  actor    TEXT,
  amount   TEXT,
  tx_hash  TEXT UNIQUE,
  block_ts INTEGER NOT NULL,
  raw      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX pet_event_pet ON pet_event (pet_ref, id);

-- Last get_pet values seen by the tail job (public chain data only).
CREATE TABLE pet_snapshot (
  pet_ref      TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  food_yocto   TEXT NOT NULL,
  staked       TEXT NOT NULL,
  soul_version INTEGER NOT NULL,
  stage        INTEGER NOT NULL,
  life_state   TEXT NOT NULL,
  taken_at     INTEGER NOT NULL
);
