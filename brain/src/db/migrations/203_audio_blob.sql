-- TTS output, served by GET /audio/:key (unguessable key), 24 h TTL.
CREATE TABLE audio_blob (
  key        TEXT PRIMARY KEY,
  turn_id    TEXT,
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX audio_blob_expiry ON audio_blob (expires_at);
