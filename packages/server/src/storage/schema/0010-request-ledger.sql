-- The call ledger (OBS-01, GEN-10): every request the host carries out, how it ended and why, and
-- every model call it made, with its stage, route, sizes, prompt parts, usage and outcome. Unknown
-- usage stays NULL, never 0 (CLI-04). What the person asked isn't kept, only its size. A request
-- goes with its workspace; one that never had a workspace is dropped once newer ones push it out.
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces (id) ON DELETE CASCADE,
  -- generate: a request from the chat; repair: fixing what the smoke check found; data: the entry
  -- part of a mixed request.
  kind TEXT NOT NULL CHECK (kind IN ('generate', 'repair', 'data')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  -- The reply's kind, such as candidate, answer or failed, and for a mixed request its entry
  -- part's after a colon, such as mixed_data:failed; NULL while it runs.
  outcome TEXT,
  -- The plain message the person read, when the reply carried one; for a mixed request, its entry
  -- part's, which is where it can fail after the interface part is done.
  message TEXT,
  -- Why it failed, for the details view and never shown as it is: the checks' findings.
  findings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(findings))
);

CREATE INDEX requests_by_workspace ON requests (workspace_id, started_at);

CREATE TABLE request_calls (
  request_id TEXT NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  call_index INTEGER NOT NULL CHECK (call_index >= 0),
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  prompt_chars INTEGER NOT NULL CHECK (prompt_chars >= 0),
  system_chars INTEGER NOT NULL CHECK (system_chars >= 0),
  prompt_parts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prompt_parts)),
  -- For a repair: the host's findings it was asked to fix, kept even when the repair works.
  diagnostics TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics)),
  started_at TEXT NOT NULL,
  duration_ms REAL,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  -- ok, failed or crashed; a failure keeps its kind, its plain message and what the provider said.
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'failed', 'crashed')),
  error TEXT,
  message TEXT,
  detail TEXT,
  PRIMARY KEY (request_id, call_index)
);
