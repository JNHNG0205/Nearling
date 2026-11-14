-- NEAR account names for email/Google (implicit) accounts: identity/names.ts
CREATE TABLE IF NOT EXISTS near_name (
  account    TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
