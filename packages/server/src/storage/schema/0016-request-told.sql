-- What a request was told of the conversation before it (A62): its subject, a workspace's ID or
-- null for the empty screen's chat, and the numbers of the chat messages, as JSON. No words: the
-- details view reads them from the chat while it still keeps them (ENG-16). NULL for a request
-- that was told none, or ran before this.
ALTER TABLE requests ADD COLUMN told TEXT CHECK (told IS NULL OR json_valid(told));
