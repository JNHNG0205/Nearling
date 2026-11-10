-- Per (pet, owner) memory (AI-brain 07 section 1). summary_enc and facts_enc are sealer blobs.
CREATE TABLE memory (
  pet_ref             TEXT NOT NULL,
  owner_account       TEXT NOT NULL,
  summary_enc         BLOB,
  facts_enc           BLOB,                         -- sealed JSON [{ fact, follow_up_on }]
  turns_since_summary INTEGER NOT NULL DEFAULT 0,
  summarised_at       INTEGER,
  archived_at         INTEGER,
  PRIMARY KEY (pet_ref, owner_account)
);
