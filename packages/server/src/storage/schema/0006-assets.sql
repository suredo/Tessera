-- Binary assets (DATA-11): one row per stored file, named by the SHA-256 of its bytes. The file
-- lives in the data folder's assets folder; a file without a row is removed at start. What refers
-- to an asset isn't kept here: cleanup finds it by looking through everything stored (the owner's
-- decision on #49), so no write path can forget to record it.
CREATE TABLE assets (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  type TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  original_name TEXT CHECK (original_name IS NULL OR length(original_name) <= 255),
  created_at TEXT NOT NULL
);
