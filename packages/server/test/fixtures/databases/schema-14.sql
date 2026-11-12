-- A Tessera database as schema 14 (0014-version-profile.sql) left it: schema 13's fixture (a workspace
-- with two tool versions and their notes, data, a saved tool with it and one in the trash, and a
-- request in the call ledger with two calls), with the profile column 0014 added, empty, and two chat messages in
-- the workspace's chat. Written from migrations 0001-0014 as they were. The fixture 0015 is tested on
-- (ENG-18). Never edit it to match a newer schema; add a fixture for each schema instead.
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES (1, '0001-tool-versions.sql', '2026-11-01T01:00:00.000Z');
INSERT INTO schema_migrations VALUES (2, '0002-workspaces.sql', '2026-11-02T02:00:00.000Z');
INSERT INTO schema_migrations VALUES (3, '0003-trash.sql', '2026-11-03T03:00:00.000Z');
INSERT INTO schema_migrations VALUES (4, '0004-record-revisions.sql', '2026-11-04T04:00:00.000Z');
INSERT INTO schema_migrations VALUES (5, '0005-recovery-snapshots.sql', '2026-11-04T05:00:00.000Z');
INSERT INTO schema_migrations VALUES (6, '0006-assets.sql', '2026-11-04T06:00:00.000Z');
INSERT INTO schema_migrations VALUES (7, '0007-data-undo.sql', '2026-11-04T07:00:00.000Z');
INSERT INTO schema_migrations VALUES (8, '0008-workspace-use.sql', '2026-11-04T08:00:00.000Z');
INSERT INTO schema_migrations VALUES (9, '0009-descriptions.sql', '2026-11-04T09:00:00.000Z');
INSERT INTO schema_migrations VALUES (10, '0010-request-ledger.sql', '2026-11-04T10:00:00.000Z');
INSERT INTO schema_migrations VALUES (11, '0011-chat.sql', '2026-11-04T11:00:00.000Z');
INSERT INTO schema_migrations VALUES (12, '0012-version-notes.sql', '2026-11-04T12:00:00.000Z');
INSERT INTO schema_migrations VALUES (13, '0013-call-code.sql', '2026-11-04T13:00:00.000Z');
INSERT INTO schema_migrations VALUES (14, '0014-version-profile.sql', '2026-11-04T14:00:00.000Z');

-- 0001-tool-versions.sql
-- Tool versions (DATA-04, CON-04): immutable artifacts named by the SHA-256 of their canonical
-- JSON. The same content is stored once; a stored version is never changed.
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

-- 0002-workspaces.sql
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

-- 0003-trash.sql
-- The trash (DATA-09): a deleted workspace or saved tool keeps its row, marked with when it was
-- deleted, until it is restored or removed for good 30 days later.
ALTER TABLE workspaces ADD COLUMN deleted_at TEXT;

ALTER TABLE saved_tools ADD COLUMN deleted_at TEXT;

-- 1 when the saved tool went to the trash with its workspace, so it comes back with it.
ALTER TABLE saved_tools ADD COLUMN deleted_with_workspace INTEGER NOT NULL DEFAULT 0
  CHECK (deleted_with_workspace IN (0, 1));

CREATE INDEX workspaces_in_trash ON workspaces (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX saved_tools_in_trash ON saved_tools (deleted_at) WHERE deleted_at IS NOT NULL;

-- 0004-record-revisions.sql
-- Each record's revision count in a workspace's data (DATA-02). It is written with the data, in the
-- same transaction, so a change planned against an older revision is refused even after a restart.
-- A record with no row here is at revision 1.
CREATE TABLE record_revisions (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision_count INTEGER NOT NULL CHECK (revision_count >= 1),
  PRIMARY KEY (workspace_id, collection, record_id)
);

-- 0005-recovery-snapshots.sql
-- Recovery snapshots (DATA-10): before a restore that drops data, the workspace's whole unit (its
-- tool version and its data) is kept here, so the person can bring it back. They go with their
-- workspace; their version is always one in the workspace's history.
CREATE TABLE recovery_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  version_hash TEXT NOT NULL REFERENCES tool_versions (hash),
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL
);

CREATE INDEX recovery_snapshots_by_workspace ON recovery_snapshots (workspace_id, created_at);

-- 0006-assets.sql
-- Binary assets (DATA-11): one row per stored file, named by the SHA-256 of its bytes. The file
-- lives in the data folder's assets folder; a file without a row is removed at start. What refers
-- to an asset isn't kept here: cleanup finds it by looking through everything stored (the owner's
-- decision on #49), so no write path can forget to record it.
CREATE TABLE assets (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  type TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  original_name TEXT CHECK (original_name IS NULL OR length(original_name) <= 255),
  created_at TEXT NOT NULL
);

-- 0007-data-undo.sql
-- Data undo (DATA-04): each change to a workspace's data keeps what it changed, so the person can
-- undo it later, if nothing has changed those records since. The newest 100 per workspace are
-- kept; older ones are discarded, and all of them go with their workspace. Numbers are never
-- given twice, even after an entry is used up, so asking for an undone change never finds another.
CREATE TABLE data_undo (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  change TEXT NOT NULL CHECK (json_valid(change)),
  -- The workspace's data revision just after the change.
  data_revision INTEGER NOT NULL CHECK (data_revision >= 1),
  created_at TEXT NOT NULL
);

CREATE INDEX data_undo_by_workspace ON data_undo (workspace_id, number);

-- 0008-workspace-use.sql
-- When each workspace was last opened (APP-03): using a tool without changing its data is use too.
-- It goes with its workspace.
CREATE TABLE workspace_use (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  used_at TEXT NOT NULL
);

-- 0009-descriptions.sql
-- A short description of what a tool does (APP-04, GEN-18): a workspace's comes from its tool's
-- creation, and a saved tool's is copied from its workspace when saved, which the person can change.
-- Empty means there is none yet: tools made before descriptions existed, or by hand.
ALTER TABLE workspaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE saved_tools ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- 0010-request-ledger.sql
-- The call ledger (OBS-01, GEN-10): every request the host carries out, how it ended and why, and
-- every model call it made, with its stage, route, sizes, prompt parts, usage and outcome. Unknown
-- usage stays NULL, never 0 (CLI-04). What the person asked isn't kept, only its size. A request
-- goes with its workspace; one that never had a workspace is dropped once newer ones push it out.
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces (id) ON DELETE CASCADE,
  -- generate: a request from the chat; repair: fixing what the smoke check found; data: the entry
  -- part of a mixed request.
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'repair', 'data')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  -- The reply's kind, such as candidate, answer or failed, and for a mixed request its entry
  -- part's after a colon, such as mixed_data:failed; NULL while it runs.
  outcome TEXT,
  -- The plain message the person read, when the reply carried one; for a mixed request, its entry
  -- part's, which is where it can fail after the interface part is done.
  message TEXT,
  -- Why it failed, for the details view and never shown as it is: the checks' findings.
  findings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(findings))
);

CREATE INDEX requests_by_workspace ON requests (workspace_id, started_at);

CREATE TABLE request_calls (
  request_id TEXT NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  call_index INTEGER NOT NULL CHECK (call_index >= 0),
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  prompt_chars INTEGER NOT NULL CHECK (prompt_chars >= 0),
  system_chars INTEGER NOT NULL CHECK (system_chars >= 0),
  prompt_parts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prompt_parts)),
  -- For a repair: the host's findings it was asked to fix, kept even when the repair works.
  diagnostics TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics)),
  started_at TEXT NOT NULL,
  duration_ms REAL,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  -- ok, failed or crashed; a failure keeps its kind, its plain message and what the provider said.
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'failed', 'crashed')),
  error TEXT,
  message TEXT,
  detail TEXT,
  PRIMARY KEY (request_id, call_index)
);

-- 0011-chat.sql
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

-- 0012-version-notes.sql
-- What each version was made for and which checks it passed (APP-05, #121): the generation's
-- plain change summary, and the host's checks its candidate passed before it was activated. A
-- version from before this, or one written by hand or imported, has neither.
ALTER TABLE workspace_versions ADD COLUMN summary TEXT;

ALTER TABLE workspace_versions ADD COLUMN checks TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checks));

-- 0013-call-code.sql
-- The code each create, edit or repair call answered with (GEN-10): its HTML, CSS and JavaScript,
-- kept with the call so an answer the host's checks refused can still be read in the details view.
-- Only the code: never what the person asked, nor the entries an answer starts a tool with.
ALTER TABLE request_calls ADD COLUMN code TEXT CHECK (code IS NULL OR json_valid(code));

ALTER TABLE workspace_versions ADD COLUMN profile TEXT;
INSERT INTO tool_versions (hash, contract_version, body, created_at) VALUES (
  '658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e',
  1,
  '{"capabilities":[],"code":{"css":"","html":"<ul id=\"list\"></ul>","js":""},"contractVersion":1,"data":{"defaults":{"items":[]},"schema":{"type":"object"},"schemaVersion":1},"pins":[],"ui":{"mode":"standard","standardVersion":1}}',
  '2026-11-04T08:00:00.000Z'
);
INSERT INTO workspaces (id, title, data, data_revision, created_at, updated_at) VALUES (
  '0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  'Garden plan',
  '{"items":[{"id":"a","text":"tomatoes"}]}',
  1,
  '2026-11-04T08:00:00.000Z',
  '2026-11-04T08:05:00.000Z'
);
INSERT INTO workspace_versions (workspace_id, number, hash, created_at, summary, checks) VALUES (
  '0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4', 1, '658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e', '2026-11-04T08:00:00.000Z',
  'Made a garden plan.', '["code","start"]'
);
INSERT INTO workspace_versions (workspace_id, number, hash, created_at, summary, checks) VALUES (
  '0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4', 2, '658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e', '2026-11-04T08:04:00.000Z',
  NULL, '["code"]'
);
INSERT INTO saved_tools (id, name, workspace_id, created_at, updated_at) VALUES (
  '1c7d3e2f-4a5b-4c6d-9e7f-8091a2b3c4d5', 'Garden', '0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  '2026-11-04T08:10:00.000Z', '2026-11-04T08:10:00.000Z'
);
INSERT INTO saved_tools (id, name, workspace_id, created_at, updated_at, deleted_at, deleted_with_workspace) VALUES (
  '2d8e4f3a-5b6c-4d7e-8f80-91a2b3c4d5e6', 'Old garden', '0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  '2026-11-04T08:11:00.000Z', '2026-11-04T08:11:00.000Z', '2026-11-04T08:12:00.000Z', 0
);
INSERT INTO requests (id, workspace_id, kind, started_at, ended_at, outcome, message) VALUES (
  '3e9f5a4b-6c7d-4e8f-9091-a2b3c4d5e6f7', NULL, 'generate',
  '2026-11-05T09:00:00.000Z', '2026-11-05T09:00:20.000Z', 'candidate', NULL
);
INSERT INTO request_calls (request_id, call_index, stage, provider, model, effort, prompt_chars, system_chars, started_at, duration_ms, input_tokens, cached_input_tokens, output_tokens, outcome) VALUES (
  '3e9f5a4b-6c7d-4e8f-9091-a2b3c4d5e6f7', 0, 'intent', 'claude-cli', 'sonnet', 'low', 1200, 3000,
  '2026-11-05T09:00:01.000Z', 4000, 900, 0, 120, 'ok'
);
INSERT INTO request_calls (request_id, call_index, stage, provider, model, effort, prompt_chars, system_chars, started_at, duration_ms, input_tokens, cached_input_tokens, output_tokens, outcome) VALUES (
  '3e9f5a4b-6c7d-4e8f-9091-a2b3c4d5e6f7', 1, 'create', 'claude-cli', 'sonnet', 'medium', 5000, 9000,
  '2026-11-05T09:00:06.000Z', 14000, 3200, 1500, 2400, 'ok'
);
INSERT INTO chat_messages (workspace_id, number, speaker, text, added_at) VALUES ('0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4', 1, 'person', 'Plant tomatoes and basil in the sunny bed', '2026-11-04T15:00:00.000Z');
INSERT INTO chat_messages (workspace_id, number, speaker, text, added_at) VALUES ('0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4', 2, 'tessera', 'Added tomatoes and basil to the garden plan.', '2026-11-04T15:00:01.000Z');
