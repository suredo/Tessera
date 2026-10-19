-- A Tessera database as schema 2 (0002-workspaces.sql) left it: a workspace with a tool version,
-- data and a saved tool. The fixture later migrations are tested on (ENG-18). Never edit it to
-- match a newer schema; add a fixture for each schema instead.
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES (1, '0001-tool-versions.sql', '2026-10-18T12:00:00.000Z');
INSERT INTO schema_migrations VALUES (2, '0002-workspaces.sql', '2026-10-19T08:00:00.000Z');

CREATE TABLE tool_versions (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
  contract_version INTEGER NOT NULL CHECK (contract_version >= 1),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER tool_versions_are_immutable
BEFORE UPDATE ON tool_versions
BEGIN
  SELECT RAISE(ABORT, 'tool versions are immutable');
END;

INSERT INTO tool_versions VALUES (
  '658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e',
  1,
  '{"capabilities":[],"code":{"css":"","html":"<ul id=\"list\"></ul>","js":""},"contractVersion":1,"data":{"defaults":{"items":[]},"schema":{"type":"object"},"schemaVersion":1},"pins":[],"ui":{"mode":"standard","standardVersion":1}}',
  '2026-10-18T12:00:00.000Z'
);

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

INSERT INTO workspaces VALUES (
  '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  'Shopping list',
  '{"items":[{"id":"a","text":"milk"}]}',
  1,
  '2026-10-19T08:00:00.000Z',
  '2026-10-19T08:05:00.000Z'
);
INSERT INTO workspace_versions VALUES (
  '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', 1, '658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e', '2026-10-19T08:00:00.000Z'
);
INSERT INTO saved_tools VALUES (
  '7a2b3c4d-5e6f-4a70-9b8c-0d1e2f3a4b5c',
  'Weekly shop',
  '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  '2026-10-19T08:06:00.000Z',
  '2026-10-19T08:06:00.000Z'
);
