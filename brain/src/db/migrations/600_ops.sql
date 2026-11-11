-- Operations (A5, A6, F3, F6). Range 600-699 = ops.
-- A5: billed cost from NEAR AI `/v1/billing/costs` per turn (nano-USD), next to the token estimate.
ALTER TABLE turn ADD COLUMN billed_cost_nano INTEGER;
ALTER TABLE turn ADD COLUMN billed_checks INTEGER NOT NULL DEFAULT 0;
CREATE INDEX turn_unbilled ON turn (created_at) WHERE billed_cost_nano IS NULL;

-- A6: speech-to-text spend counts toward the global daily cap.
ALTER TABLE spend_daily ADD COLUMN stt_nano INTEGER NOT NULL DEFAULT 0;

-- F3: feeder retries. feed_retry_at = when the next try may run; feed_try_tx = hash of a failed try,
-- re-checked on chain for a `fed` event before any retry so an order never feeds twice.
-- feed_nonce = the feeder's access key nonce sum before the last try (no-hash failures).
ALTER TABLE feed_order ADD COLUMN feed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feed_order ADD COLUMN feed_retry_at INTEGER;
ALTER TABLE feed_order ADD COLUMN feed_try_tx TEXT;
ALTER TABLE feed_order ADD COLUMN feed_nonce TEXT;   -- feeder key nonce sum before the last try

-- F6: NEAR AI org balance read after each successful sweep. Amounts in nano-USD.
CREATE TABLE org_balance (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           TEXT NOT NULL,
  remaining_nano   INTEGER,
  spend_limit_nano INTEGER,
  total_spent_nano INTEGER,
  fetched_at       INTEGER NOT NULL
);
