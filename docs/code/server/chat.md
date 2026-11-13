---
type: Code Module
title: "Workspace chat"
description: "Each workspace's conversation, and the empty screen's, kept in the data folder: the person's requests and Tessera's replies in order, the newest 200, through the trash and back, removed with it for good, never in an export, and searchable by its words within its own chat."
resource: ../../../packages/server/src/chat/
implements: [APP-03]
tests: [../../../packages/server/test/chat.test.ts]
tags: [code, server, chat, app]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-12T22:00:00Z }
---

# Purpose

Keeps each workspace's chat with it, as `APP-03` asks and [ADR 0011](../../decisions/adr/0011-workspace-chat.md) decides: what the person asked and what Tessera answered, so the conversation beside the tool (`APP-01`, [#132](https://github.com/suredo/Tessera/issues/132)) is still there after a reload or the next day. The host app shows it; this module only keeps it.

# Entry points

- `src/chat/chat.ts`: `listChat` gives a chat's kept messages, oldest first, as the contracts' `ChatMessage`: a workspace's, or with none the empty screen's, what was said with no tool open (A62). `addToChat` adds one or more `ChatEntry` to the end in one transaction and answers them as kept. Both refuse a workspace that is missing or in the trash, in the [workspace functions'](workspaces.md) own words.
  - `searchChat` gives a chat's messages that share the most telling words with a text, best first, at most `CHAT_SEARCH_LIMIT` (5), leaving out given numbers (A62). `searchWords` picks those words: letters and digits in any script, without case, leaving out words of two letters or fewer and a short list of common English, Portuguese and Spanish words. Each word is searched as a quoted string, so nothing in a request can act as search syntax.
- The [host API](host-api.md) answers `chat.list` and `chat.add` with them. The [contracts](../contracts/package.md) define both actions and the message shapes in `src/chat.ts`.

# Behavior

- **Kept in two tables,** `chat_messages`, from migration `0011-chat.sql` ([storage](storage.md)), one row per message, keyed by workspace and number, removed with its workspace (`ON DELETE CASCADE`); and `home_chat_messages`, from `0015-chat-search.sql`, the empty screen's, keyed by number.
- **Searchable within its own chat** (A62). `chat_search`, an FTS5 full-text index with accents and case folded (`unicode61 remove_diacritics 2`), holds every kept message with its thread, a workspace's ID or `''` for the empty screen's. Triggers on both tables keep it in step, so a message that goes, with the oldest or with its workspace, goes from the search too; the migration indexed the messages already kept. A search is ranked by `bm25` and never crosses threads.
- **A turn is added after the reply** (`APP-03`). The host app adds the person's request and Tessera's reply once it has said what happened, so a reply is the message the person read. A request that ends with no workspace, such as a failed first creation or a question with no tool open, keeps its turn in the empty screen's chat (A62).
- **Messages are numbered and kept in order.** Numbers count from 1 in each workspace and never change. Past `CHAT_MESSAGES_KEPT` (200), the oldest go as new ones come.
- **Each message is bounded** (`CON-01`): one or two per call, the person's or Tessera's, nonempty after trimming and at most `CHAT_TEXT_LIMIT` (8,000) characters. Anything else is refused as invalid, and nothing is kept.
- **It goes with its workspace** (`DATA-09`). A workspace in the [trash](trash.md) keeps its chat but takes no more, gets it back when restored, and loses it when removed for good, through the cascade.
- **Exports leave it out** (ADR 0011). The [archives](archives.md) never read `chat_messages`, so an export file holds no chat and an imported workspace starts with none.

# Pitfalls

- **The text is the person's own words,** kept on their machine in the data folder. Nothing else reads it: not the [call ledger](ledger.md), which keeps only sizes, not exports, and no prompt except as the conversation a request is told: the last exchange and the messages that share its words, quoted and capped ([generation](generation.md), A62).
- **The host app writes Tessera's replies.** Only the host app can reach the host API; a generated tool can't (`RUN-01`), so a tool can't write words into the chat as Tessera.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `chat.ts`: `listChat`, `addToChat`, `CHAT_SEARCH_LIMIT`, `searchWords`, `searchChat`
- `index.ts`: `addToChat`, `CHAT_SEARCH_LIMIT`, `listChat`, `searchChat`, `searchWords`, `ChatEntry` (type), `ChatMessage` (type)
