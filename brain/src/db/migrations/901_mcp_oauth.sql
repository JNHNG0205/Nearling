-- MCP catalog connections (web /mcp): which catalog tool a server row is, OAuth clients Petto
-- registered with a provider (dynamic registration), and sign-ins in progress (state -> owner).
ALTER TABLE mcp_server ADD COLUMN catalog_id TEXT;

CREATE TABLE mcp_oauth_client (
  provider    TEXT PRIMARY KEY,   -- catalog id
  client_enc  BLOB NOT NULL,      -- sealed JSON client information (client_id, maybe client_secret)
  created_at  INTEGER NOT NULL
);

CREATE TABLE mcp_oauth_state (
  state         TEXT PRIMARY KEY,
  owner_account TEXT NOT NULL,
  catalog_id    TEXT NOT NULL,
  verifier_enc  BLOB NOT NULL,    -- sealed PKCE code verifier
  created_at    INTEGER NOT NULL
);
