-- Feed the Brain orders (AI-brain architectual/02-data-model.md "order", 04 section 3).
-- Table is `feed_order` because ORDER is an SQL keyword. Amounts are yocto strings.
CREATE TABLE feed_order (
  id              TEXT PRIMARY KEY,
  pet_ref         TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('direct', 'live', 'simulated')),
  pack_id         TEXT NOT NULL,
  payer_hint      TEXT,
  quote           TEXT,               -- JSON, live only
  deposit_address TEXT,               -- live only
  deadline        INTEGER,            -- live only, unix ms
  status          TEXT NOT NULL CHECK (status IN
                    ('created', 'quoted', 'pending', 'settled', 'feeding', 'fed', 'failed', 'refunded', 'expired')),
  feed_yocto      TEXT NOT NULL,
  feed_tx         TEXT UNIQUE,
  settle_ref      TEXT UNIQUE,
  feeding_day     INTEGER,            -- UTC day index when the feeder took it (daily cap)
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX feed_order_status ON feed_order (status, mode);
