-- Wallet approvals and saved recipients (AI-brain architectual/02-data-model.md, 05 section 5).
CREATE TABLE approval (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('send', 'stake', 'transfer_pet')),
  network      TEXT NOT NULL DEFAULT 'testnet' CHECK (network = 'testnet'),
  account_id   TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  pet_ref      TEXT,
  receiver_id  TEXT NOT NULL,
  amount_yocto TEXT,
  token_id     TEXT,
  validator    TEXT,
  status       TEXT NOT NULL CHECK (status IN
                 ('requested', 'approved', 'signed', 'final', 'rejected', 'expired', 'failed')),
  tx_hash      TEXT UNIQUE,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  approved_at  INTEGER,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX approval_device ON approval (device_id, status);

CREATE TABLE wallet_recipient (
  owner_account TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  label         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (owner_account, account_id)
);
