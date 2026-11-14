-- The owner's original request behind a task, so after an approved step the agent can continue it
-- (enable the action, then create the event). Sealed like chat text.
ALTER TABLE mcp_task ADD COLUMN goal_enc BLOB;
