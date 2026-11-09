-- Which verification profile's behavior check a version passed before it was activated (VER-08,
-- #290): its ID, with "behavior" among the version's checks. A version with no behavior check,
-- from before this, or written by hand or imported without one, has none.
ALTER TABLE workspace_versions ADD COLUMN profile TEXT;
