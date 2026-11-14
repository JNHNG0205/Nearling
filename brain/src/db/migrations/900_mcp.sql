-- MCP tools (web /mcp): servers an owner connected, and tool calls the pet proposed in chat.
-- Tokens, arguments and results are sealed (AES-GCM) like chat text; nothing here is logged.
CREATE TABLE mcp_server (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_account TEXT NOT NULL,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  token_enc     BLOB,            -- optional bearer token, sealed with context "mcp:<owner>"
  tools_json    TEXT NOT NULL,   -- [{ name, description, input_schema }] from tools/list (public tool metadata)
  created_at    INTEGER NOT NULL,
  refreshed_at  INTEGER NOT NULL
);
CREATE INDEX mcp_server_owner ON mcp_server (owner_account);

-- One proposed tool call. Runs only after the owner approves it (pending -> approved -> done | failed),
-- or never (declined). `follow_turn_id` is the pet's reply about the result.
CREATE TABLE mcp_task (
  id             TEXT PRIMARY KEY,
  turn_id        TEXT NOT NULL,
  pet_ref        TEXT NOT NULL,
  owner_account  TEXT NOT NULL,
  server_id      INTEGER NOT NULL,
  tool           TEXT NOT NULL,
  args_enc       BLOB NOT NULL,
  status         TEXT NOT NULL,
  result_enc     BLOB,
  error_code     TEXT,
  follow_turn_id TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX mcp_task_turn ON mcp_task (turn_id);
