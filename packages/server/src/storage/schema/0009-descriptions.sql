-- A short description of what a tool does (APP-04, GEN-18): a workspace's comes from its tool's
-- creation, and a saved tool's is copied from its workspace when saved, which the person can change.
-- Empty means there is none yet: tools made before descriptions existed, or by hand.
ALTER TABLE workspaces ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE saved_tools ADD COLUMN description TEXT NOT NULL DEFAULT '';
