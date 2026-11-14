-- Pet battles (docs/superpowers/specs/2026-11-14-pet-battle-design.md): one row per finished
-- battle, and one on-chain `record_battle` job per battle (battle_id makes retries safe).
CREATE TABLE battle (
  id         TEXT PRIMARY KEY,
  pet_a      TEXT NOT NULL,
  pet_b      TEXT NOT NULL,
  winner     INTEGER,            -- 0 = pet_a, 1 = pet_b, NULL = draw
  reason     TEXT NOT NULL,      -- ko | run | turns | forfeit
  created_at INTEGER NOT NULL
);
CREATE INDEX battle_pair ON battle (pet_a, pet_b, created_at);

CREATE TABLE battle_job (
  battle_id       TEXT PRIMARY KEY REFERENCES battle (id),
  contract        TEXT NOT NULL,
  args            TEXT NOT NULL,  -- JSON for record_battle
  status          TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'settled', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  tx_hash         TEXT,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX battle_job_due ON battle_job (status, next_attempt_at);
