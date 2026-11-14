-- A tool's permission to change things through a connection (ADR 0015 point 4, A70): kept once the
-- person allows the tool's first write through it, per workspace and connection, and taken back by
-- removing the row. A workspace's or a connection's removal removes its permissions, so a
-- connection added again under the same name starts with none.
CREATE TABLE connection_permissions (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connection TEXT NOT NULL REFERENCES connections (name) ON DELETE CASCADE,
  allowed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, connection)
);
