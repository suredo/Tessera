-- A workspace's chat (APP-01, APP-03, ADR 0011): what the person asked and what Tessera
-- answered, in order. It goes with its workspace: kept while the workspace is in the trash, removed
-- with it for good. Exports never include it. Only the newest CHAT_MESSAGES_KEPT are kept.
CREATE TABLE chat_messages (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  speaker TEXT NOT NULL CHECK (speaker IN ('person', 'tessera')),
  text TEXT NOT NULL CHECK (length(text) >= 1),
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, number)
);
