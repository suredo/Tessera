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
