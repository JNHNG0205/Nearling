-- Offline care events from the device, or from the web simulator (device_id NULL). Idempotent by id.
CREATE TABLE care_event (
  id          TEXT PRIMARY KEY,
  pet_ref     TEXT NOT NULL,
  device_id   TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('pat', 'rock', 'shake', 'sleep')),
  at          INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX care_event_pet ON care_event (pet_ref, at);
