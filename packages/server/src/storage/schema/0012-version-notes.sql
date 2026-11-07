-- What each version was made for and which checks it passed (APP-05, #121): the generation's
-- plain change summary, and the host's checks its candidate passed before it was activated. A
-- version from before this, or one written by hand or imported, has neither.
ALTER TABLE workspace_versions ADD COLUMN summary TEXT;

ALTER TABLE workspace_versions ADD COLUMN checks TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checks));
