-- Workspaces, their version history and the saved-tools library (DATA-08), each written as it
-- changes. A workspace's data is JSON; its current version is the last entry of its history.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  data TEXT NOT NULL CHECK (json_valid(data)),
  data_revision INTEGER NOT NULL CHECK (data_revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Restoring an older version adds a new entry (DATA-04), so the history only grows.
CREATE TABLE workspace_versions (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  hash TEXT NOT NULL REFERENCES tool_versions (hash),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, number)
);

CREATE INDEX workspace_versions_by_hash ON workspace_versions (hash);

CREATE TRIGGER workspace_versions_are_append_only
BEFORE UPDATE ON workspace_versions
BEGIN
  SELECT RAISE(ABORT, 'version history is append-only');
END;

-- A saved tool follows its workspace's latest version (A32); Continue opens that workspace.
CREATE TABLE saved_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX saved_tools_by_workspace ON saved_tools (workspace_id);
