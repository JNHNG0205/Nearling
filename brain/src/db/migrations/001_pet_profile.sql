-- Off-chain pet state keyed by NFT identity (AI-brain architectual/02-data-model.md).
-- pet_ref = "<contract>:<token_id>". Encrypted columns are BLOBs from crypto.seal().
CREATE TABLE pet_profile (
  pet_ref            TEXT PRIMARY KEY,
  owner_account      TEXT NOT NULL,
  nickname_enc       BLOB,
  owner_tz           TEXT,
  form               TEXT NOT NULL DEFAULT 'base' CHECK (form IN ('base', 'winged')),
  evolved_at         INTEGER,
  care_pat           INTEGER NOT NULL DEFAULT 0,
  care_rock          INTEGER NOT NULL DEFAULT 0,
  care_sleep         INTEGER NOT NULL DEFAULT 0,
  care_mood          INTEGER NOT NULL DEFAULT 80,
  care_mood_at       INTEGER,
  sleeping_until     INTEGER,
  equipped_shirt     TEXT,
  last_owner_turn_at INTEGER,
  created_at         INTEGER NOT NULL
);
