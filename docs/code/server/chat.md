---
type: Code Module
title: "Workspace chat"
description: "Each workspace's conversation, kept with it in the data folder: the person's requests and Tessera's replies in order, the newest 200, through the trash and back, removed with it for good, and never in an export."
resource: ../../../packages/server/src/chat/
implements: [APP-03]
tests: [../../../packages/server/test/chat.test.ts]
tags: [code, server, chat, app]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-06T22:22:19Z }
---

# Purpose

Keeps each workspace's chat with it, as `APP-03` asks and [ADR 0011](../../decisions/adr/0011-workspace-chat.md) decides: what the person asked and what Tessera answered, so the conversation beside the tool (`APP-01`, [#132](https://github.com/suredo/Tessera/issues/132)) is still there after a reload or the next day. The host app shows it; this module only keeps it.

# Entry points

- `src/chat/chat.ts`: `listChat` gives a workspace's kept messages, oldest first, as the contracts' `ChatMessage`. `addToChat` adds one or more `ChatEntry` to the end in one transaction and answers them as kept. Both refuse a workspace that is missing or in the trash, in the [workspace functions'](workspaces.md) own words.
- The [host API](host-api.md) answers `chat.list` and `chat.add` with them. The [contracts](../contracts/package.md) define both actions and the message shapes in `src/chat.ts`.

# Behavior

- **Kept in one table,** `chat_messages`, from migration `0011-chat.sql` ([storage](storage.md)): one row per message, keyed by workspace and number, removed with its workspace (`ON DELETE CASCADE`).
- **A turn is added after the reply** (`APP-03`). The host app adds the person's request and Tessera's reply once it has said what happened, so a reply is the message the person read. A request that ends with no workspace, such as a failed first creation, keeps no chat, as there is no workspace to keep it in.
- **Messages are numbered and kept in order.** Numbers count from 1 in each workspace and never change. Past `CHAT_MESSAGES_KEPT` (200), the oldest go as new ones come.
- **Each message is bounded** (`CON-01`): one or two per call, the person's or Tessera's, nonempty after trimming and at most `CHAT_TEXT_LIMIT` (8,000) characters. Anything else is refused as invalid, and nothing is kept.
- **It goes with its workspace** (`DATA-09`). A workspace in the [trash](trash.md) keeps its chat but takes no more, gets it back when restored, and loses it when removed for good, through the cascade.
- **Exports leave it out** (ADR 0011). The [archives](archives.md) never read `chat_messages`, so an export file holds no chat and an imported workspace starts with none.

# Pitfalls

- **The text is the person's own words,** kept on their machine in the data folder. Nothing else reads it: not the [call ledger](ledger.md), which keeps only sizes, not exports, and not any prompt.
- **The host app writes Tessera's replies.** Only the host app can reach the host API; a generated tool can't (`RUN-01`), so a tool can't write words into the chat as Tessera.

# Symbols (generated)

Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.

- `chat.ts`: `listChat`, `addToChat`
- `index.ts`: `addToChat`, `listChat`, `ChatEntry` (type), `ChatMessage` (type)
