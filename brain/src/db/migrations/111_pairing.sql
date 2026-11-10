-- Hatch & Pair sessions (AI-brain architectual/02, 05 section 2). token = random 128-bit, in the QR.
CREATE TABLE pairing (
  id            TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL REFERENCES device (id),
  token         TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'awaiting_confirm', 'confirmed', 'expired', 'cancelled')),
  pet_ref       TEXT,
  owner_account TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX pairing_device ON pairing (device_id, created_at);
