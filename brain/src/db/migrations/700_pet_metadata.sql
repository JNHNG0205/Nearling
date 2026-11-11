-- Public pet metadata pinned to IPFS via Pinata (docs/IPFS.md). One row per pinned version.
-- Only public data is ever pinned; hashes are hex sha256 of the exact pinned bytes.
CREATE TABLE pet_metadata (
  pet_ref         TEXT NOT NULL,
  version         INTEGER NOT NULL,
  json_cid        TEXT NOT NULL,
  png_cid         TEXT NOT NULL,
  json_sha256     TEXT NOT NULL,
  png_sha256      TEXT NOT NULL,
  pinned_at       INTEGER NOT NULL,
  chain_synced_at INTEGER, -- set_metadata succeeded for this version (pets-v9+)
  PRIMARY KEY (pet_ref, version)
);

-- Last look signature seen by the 60 s watch job (soul version, stage, form, shirt, name).
CREATE TABLE pet_metadata_watch (
  pet_ref    TEXT PRIMARY KEY,
  sig        TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
