-- Timeline from real contract events (LIMITATIONS D4). Rebuilds pet_event so one tx can hold many
-- events: idempotency moves from tx_hash UNIQUE to (tx_hash, receipt_id, log_index, pet_ref).
-- `source` is 'event' (EVENT_JSON log read via the FastNEAR tx indexer) or 'snapshot' (get_pet diff,
-- written only while the indexer fails). Rows that existed before this migration were all snapshot rows.
-- pet_ref is `<contract>:<token_id>`, or the bare contract id for contract-wide events (credit_swept).
CREATE TABLE pet_event_v2 (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_ref    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  actor      TEXT,
  amount     TEXT,
  tx_hash    TEXT,
  receipt_id TEXT,
  log_index  INTEGER,
  source     TEXT NOT NULL DEFAULT 'snapshot',
  block_ts   INTEGER NOT NULL,
  raw        TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO pet_event_v2 (id, pet_ref, kind, actor, amount, tx_hash, source, block_ts, raw)
  SELECT id, pet_ref, kind, actor, amount, tx_hash, 'snapshot', block_ts, raw FROM pet_event;
DROP TABLE pet_event;
ALTER TABLE pet_event_v2 RENAME TO pet_event;
CREATE UNIQUE INDEX pet_event_log ON pet_event (tx_hash, receipt_id, log_index, pet_ref);
CREATE INDEX pet_event_pet ON pet_event (pet_ref, block_ts);

-- Per contract: highest tx block height whose receipts are all final and already read.
CREATE TABLE timeline_cursor (
  contract   TEXT PRIMARY KEY,
  height     INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
