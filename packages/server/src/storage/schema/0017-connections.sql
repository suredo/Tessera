-- Connections to outside services that the person adds (CAP-02, ADR 0015): a name, the origins it
-- may reach and how its key is sent, as JSON, and the key itself, NULL for a service that needs
-- none. The key stays in this table: no listing, export, prompt, ledger or log reads it, and only
-- the host's request path (#349) sends it, to the connection's own origins. Like the rest of the
-- data folder, it isn't encrypted at rest.
CREATE TABLE connections (
  name TEXT PRIMARY KEY CHECK (name GLOB '[a-z]*' AND length(name) <= 40),
  origins TEXT NOT NULL CHECK (json_valid(origins)),
  auth TEXT NOT NULL CHECK (json_valid(auth)),
  key TEXT,
  added_at TEXT NOT NULL
);
