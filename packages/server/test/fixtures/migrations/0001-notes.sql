-- A stand-in table for the storage smoke test; Tessera's real tables come in M1.
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
