-- Talk turns (AI-brain architectual/02-data-model.md "Talk"). id = usage_ref for the on-chain charge (D4).
-- user_text_enc / reply_text_enc are sealer blobs (AES-256-GCM, per-pet key). Never logged.
CREATE TABLE turn (
  id                 TEXT PRIMARY KEY,
  pet_ref            TEXT NOT NULL,
  owner_account      TEXT NOT NULL,
  device_id          TEXT,
  request_id         TEXT NOT NULL,
  channel            TEXT NOT NULL CHECK (channel IN ('device', 'web', 'proactive')),
  status             TEXT NOT NULL CHECK (status IN ('processing', 'done', 'failed', 'canned')),
  user_text_enc      BLOB,
  reply_text_enc     BLOB,
  emotion            TEXT,
  soul_version       INTEGER,
  model              TEXT,
  inference_id       TEXT,
  chat_id            TEXT,
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  provider_cost_nano INTEGER,
  stt_ms             INTEGER,
  llm_ms             INTEGER,
  tts_ms             INTEGER,
  audio_key          TEXT,
  error_code         TEXT,
  created_at         INTEGER NOT NULL,
  completed_at       INTEGER,
  UNIQUE (pet_ref, request_id)                      -- D3 retry idempotency
);
CREATE INDEX turn_pet_owner ON turn (pet_ref, owner_account, created_at);
CREATE INDEX turn_pet_day ON turn (pet_ref, created_at);
