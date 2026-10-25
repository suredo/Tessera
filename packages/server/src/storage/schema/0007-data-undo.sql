-- Data undo (DATA-04): each change to a workspace's data keeps what it changed, so the person can
-- undo it later, if nothing has changed those records since. The newest 100 per workspace are
-- kept; older ones are discarded, and all of them go with their workspace.
CREATE TABLE data_undo (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  change TEXT NOT NULL CHECK (json_valid(change)),
  -- The workspace's data revision just after the change.
  data_revision INTEGER NOT NULL CHECK (data_revision >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, number)
);
