-- What was said with no tool open (A62): the empty screen's chat, kept like a workspace's, so a
-- request made with nothing open has its earlier turns too. Only the newest CHAT_MESSAGES_KEPT are
-- kept. Exports never include it.
CREATE TABLE home_chat_messages (
  number INTEGER PRIMARY KEY CHECK (number >= 1),
  speaker TEXT NOT NULL CHECK (speaker IN ('person', 'tessera')),
  text TEXT NOT NULL CHECK (length(text) >= 1),
  added_at TEXT NOT NULL
);

-- Every kept message, searchable by its words within its own chat (A62): the thread is a
-- workspace's ID, or '' for the empty screen's. Accents and letter case don't count, so "pao"
-- finds "pão". Triggers keep it in step with both tables, a workspace's removal included.
CREATE VIRTUAL TABLE chat_search USING fts5(
  text,
  thread UNINDEXED,
  number UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO chat_search (text, thread, number)
  SELECT text, workspace_id, number FROM chat_messages;

CREATE TRIGGER chat_messages_searched AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_search (text, thread, number) VALUES (new.text, new.workspace_id, new.number);
END;
CREATE TRIGGER chat_messages_unsearched AFTER DELETE ON chat_messages BEGIN
  DELETE FROM chat_search WHERE thread = old.workspace_id AND number = old.number;
END;
CREATE TRIGGER home_chat_messages_searched AFTER INSERT ON home_chat_messages BEGIN
  INSERT INTO chat_search (text, thread, number) VALUES (new.text, '', new.number);
END;
CREATE TRIGGER home_chat_messages_unsearched AFTER DELETE ON home_chat_messages BEGIN
  DELETE FROM chat_search WHERE thread = '' AND number = old.number;
END;
