-- A Tessera database as schema 1 (0001-tool-versions.sql) left it, with one tool version: the
-- fixture later migrations are tested on (ENG-18). Never edit it to match a newer schema; add a
-- fixture for each schema instead.
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES (1, '0001-tool-versions.sql', '2026-10-18T12:00:00.000Z');

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

INSERT INTO tool_versions VALUES (
  '658971542b342509b035cd99f0dd5d483273a2b1c432967afd963641794e869e',
  1,
  '{"capabilities":[],"code":{"css":"","html":"<ul id=\"list\"></ul>","js":""},"contractVersion":1,"data":{"defaults":{"items":[]},"schema":{"type":"object"},"schemaVersion":1},"pins":[],"ui":{"mode":"standard","standardVersion":1}}',
  '2026-10-18T12:00:00.000Z'
);
