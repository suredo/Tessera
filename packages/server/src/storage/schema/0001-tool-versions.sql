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
