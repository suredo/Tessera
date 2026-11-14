-- A tool's recent requests through its connections (ADR 0015 point 7, A73): where, when, read or
-- write, and how each ended, for the details view (OBS-01). Never the key: the address is the one
-- the tool asked for, before the host adds the key, cut to 300 characters. Only the newest 50 per
-- workspace are kept. A workspace's removal removes its requests; a connection's doesn't, so what
-- was sent through it can still be seen.
CREATE TABLE connection_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connection TEXT NOT NULL,
  method TEXT NOT NULL,
  address TEXT NOT NULL CHECK (length(address) <= 300),
  at TEXT NOT NULL,
  status_code INTEGER,
  refusal TEXT,
  CHECK ((status_code IS NULL) <> (refusal IS NULL))
);
CREATE INDEX connection_requests_by_workspace ON connection_requests (workspace_id, id);
