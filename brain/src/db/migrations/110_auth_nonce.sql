-- NEP-413 sign-in nonces (AI-brain architectual/02). Single use: deleted when consumed.
CREATE TABLE auth_nonce (
  nonce      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
