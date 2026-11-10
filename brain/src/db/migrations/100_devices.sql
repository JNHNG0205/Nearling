-- Devices and pairing (AI-brain architectual/02-data-model.md, 05). Owned by the identity/devices area.
CREATE TABLE device (
  id            TEXT PRIMARY KEY,
  hw_id         TEXT NOT NULL UNIQUE,
  secret_hash   TEXT NOT NULL,
  token_hash    TEXT UNIQUE,
  pet_ref       TEXT,
  owner_account TEXT,
  bound_at      INTEGER,
  revoked_at    INTEGER,
  last_seen_at  INTEGER,
  fw_version    TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX device_pet ON device (pet_ref);
