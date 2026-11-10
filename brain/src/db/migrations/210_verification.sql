-- TEE verification of each reply and the attestation cache (AI-brain architectual/02, 03 section 7).
-- Owned by the verification/receipts area. Never stores request or response bytes, only hashes.
CREATE TABLE attestation (
  id             TEXT PRIMARY KEY,
  model          TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  fetched_at     INTEGER NOT NULL,
  ok             INTEGER NOT NULL DEFAULT 0,      -- 1 = nonce echoed and at least one model signer passed NRAS
  model_signers  TEXT NOT NULL DEFAULT '[]',      -- json: lowercase addresses whose NRAS check passed
  gateway_signer TEXT,                            -- lowercase, from gateway_attestation
  nras           TEXT NOT NULL DEFAULT '[]',      -- json: per model attestation { signer, pass, reason }
  tdx            TEXT NOT NULL DEFAULT 'not checked in app',
  reason         TEXT
);
CREATE INDEX attestation_model ON attestation (model, fetched_at);

CREATE TABLE verification (
  turn_id        TEXT PRIMARY KEY,
  pet_ref        TEXT NOT NULL,
  model          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'model_verified', 'gateway_verified', 'unverified')),
  signature_kind TEXT,
  req_hash       TEXT,
  resp_hash      TEXT,
  signer         TEXT,
  attestation_id TEXT,
  reason         TEXT,
  public         INTEGER NOT NULL DEFAULT 0,      -- opt-in public evidence
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
