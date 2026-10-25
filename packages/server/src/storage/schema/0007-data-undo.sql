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
