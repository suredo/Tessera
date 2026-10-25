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
