-- When each workspace was last opened (APP-03): using a tool without changing its data is use too.
-- It goes with its workspace.
CREATE TABLE workspace_use (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  used_at TEXT NOT NULL
);
