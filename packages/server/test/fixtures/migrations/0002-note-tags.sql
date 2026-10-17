-- A second stand-in migration, with a foreign key, so the smoke test checks order and enforcement.
CREATE TABLE note_tags (
  note_id INTEGER NOT NULL REFERENCES notes (id),
  tag TEXT NOT NULL
);
