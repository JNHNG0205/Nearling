-- One on-chain `charge` per completed turn (AI-brain 04 section 2). Written in the same DB
-- transaction as the reply; usage_ref = turn_id makes every retry safe.
CREATE TABLE charge_job (
  turn_id         TEXT PRIMARY KEY REFERENCES turn (id),
  pet_ref         TEXT NOT NULL,
  cost_micro      INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'settled', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  tx_hash         TEXT,
  charged_micro   INTEGER,
  source          TEXT,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX charge_job_due ON charge_job (status, next_attempt_at);
