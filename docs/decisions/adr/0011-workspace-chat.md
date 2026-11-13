---
type: Decision
title: "ADR 0011. A workspace keeps its chat, and exports leave it out"
description: "Each workspace keeps its conversation in the data folder, through the trash and back; export files carry only the tool and its data."
tags: [decisions, app, data, chat]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-12T19:00:00Z }
---

# ADR 0011. A workspace keeps its chat, and exports leave it out

## Context

`APP-01` puts a chat beside the tool, and `APP-03` says the chat belongs to its workspace. Neither said whether the conversation outlives the page, or whether it travels in an [export file](../../code/server/archives.md). The person's words are the most personal thing Tessera holds: the [call ledger](../../code/server/ledger.md) keeps only their size. The owner chose on 2026-11-06, while planning [#132](https://github.com/suredo/Tessera/issues/132).

## Decision

- **Each workspace keeps its chat in the data folder:** the person's requests and Tessera's replies as the person read them, in order, the newest 200. It is still there after a reload or the next day.
- **It goes with its workspace:** kept while the workspace is in the trash, back when it is restored, and removed with it for good (`DATA-09`).
- **Exports carry the tool and its data only.** A workspace's or saved tool's export file never holds its chat, so the person's words don't leave in a file they share. A saved tool never carries a chat, and Use again starts a new workspace with none.

## Consequences

- A storage migration, `0011-chat.sql`, and two host actions, `chat.list` and `chat.add`, in the [chat module](../../code/server/chat.md). The archive format doesn't change.
- The host app adds each turn after it has said what happened, so a reply is the message the person read. A request that ends with no workspace, such as a failed first creation, keeps no chat.
- Importing a workspace gives it an empty chat.

## Amendment, 2026-11-12: the chat gives requests their context (A62)

Each request was read alone, so "remove what I just listed" had nothing to go on (L-101). The owner chose to use the chat Tessera already keeps as the context requests are told:

- **What is said with no tool open is kept too,** in the empty screen's own chat, like a workspace's: the newest 200, in the data folder, never in an export. A request that ends with no workspace now keeps its turn there.
- **The chat is searchable,** within one subject only: a workspace's chat, or the empty screen's. A full-text index, kept in step with the chat by the database, finds earlier messages that share a request's telling words.
- **Requests will be told their context** ([#338](https://github.com/suredo/Tessera/issues/338)'s second step): the last exchange and the best matches, quoted as data and capped within every stage's budget. Until then, no prompt reads the chat.

The person's words still never leave the data folder in a file, and the call ledger still keeps only sizes.
