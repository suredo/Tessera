-- The trash (DATA-09): a deleted workspace or saved tool keeps its row, marked with when it was
-- deleted, until it is restored or removed for good 30 days later.
ALTER TABLE workspaces ADD COLUMN deleted_at TEXT;

ALTER TABLE saved_tools ADD COLUMN deleted_at TEXT;

-- 1 when the saved tool went to the trash with its workspace, so it comes back with it.
ALTER TABLE saved_tools ADD COLUMN deleted_with_workspace INTEGER NOT NULL DEFAULT 0
  CHECK (deleted_with_workspace IN (0, 1));

CREATE INDEX workspaces_in_trash ON workspaces (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX saved_tools_in_trash ON saved_tools (deleted_at) WHERE deleted_at IS NOT NULL;
