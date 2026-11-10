-- Global provider spend per UTC day (GLOBAL_DAILY_SPEND_CAP_USD). day = 'YYYY-MM-DD'.
CREATE TABLE spend_daily (
  day           TEXT PRIMARY KEY,
  provider_nano INTEGER NOT NULL DEFAULT 0,
  tts_chars     INTEGER NOT NULL DEFAULT 0
);
