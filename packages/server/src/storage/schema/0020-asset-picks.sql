-- Images the person picked for a tool (CAP-03, A80): each holds its asset for the workspace it was
-- picked in, so the tool can show it and save its ID in its data, for 24 hours from its latest pick.
-- Cleanup lets go of older picks first, then treats the asset as any other: kept while anything
-- names it. A workspace's removal removes its picks.
CREATE TABLE asset_picks (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets (hash),
  picked_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, asset_id)
);
CREATE INDEX asset_picks_by_time ON asset_picks (picked_at);
