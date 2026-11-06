// Docs: docs/code/server/chat.md
import {
  CHAT_MESSAGES_KEPT,
  CHAT_SPEAKERS,
  type ChatEntry,
  type ChatMessage,
} from "@tessera/contracts";
import { z } from "zod";
import { existingWorkspace, type Store } from "../workspaces/index.ts";

// A workspace's chat (APP-01, APP-03, ADR 0011): what the person asked and what Tessera
// answered, kept in order with the workspace. The host app adds each turn once it has said what
// happened, so a reply is the message the person read. A workspace in the trash keeps its chat and
// takes no more; removing it for good removes the chat with it. Exports never read this table.

const messageRow = z.object({
  number: z.number(),
  speaker: z.enum(CHAT_SPEAKERS),
  text: z.string(),
  added_at: z.string(),
});

const asMessage = (row: z.infer<typeof messageRow>): ChatMessage => ({
  number: row.number,
  from: row.speaker,
  text: row.text,
  at: row.added_at,
});

/** The workspace's kept messages, oldest first. Refused if it is missing or in the trash. */
export function listChat(store: Store, workspaceId: string): ChatMessage[] {
  existingWorkspace(store, workspaceId);
  return store.db
    .all(
      messageRow,
      "SELECT number, speaker, text, added_at FROM chat_messages WHERE workspace_id = ? ORDER BY number",
      workspaceId,
    )
    .map(asMessage);
}

/**
 * Adds messages to the end of the workspace's chat, in order, and lets the oldest go past
 * `CHAT_MESSAGES_KEPT`. Refused if the workspace is missing or in the trash. Returns them as kept.
 */
export function addToChat(
  store: Store,
  workspaceId: string,
  entries: readonly ChatEntry[],
): ChatMessage[] {
  return store.db.transaction(() => {
    existingWorkspace(store, workspaceId);
    const last =
      store.db.get(
        z.object({ last: z.number().nullable() }),
        "SELECT MAX(number) AS last FROM chat_messages WHERE workspace_id = ?",
        workspaceId,
      )?.last ?? 0;
    const at = store.now().toISOString();
    const added = entries.map((entry, index): ChatMessage => ({
      ...entry,
      number: last + index + 1,
      at,
    }));
    for (const message of added) {
      store.db.run(
        "INSERT INTO chat_messages (workspace_id, number, speaker, text, added_at) VALUES (?, ?, ?, ?, ?)",
        workspaceId,
        message.number,
        message.from,
        message.text,
        message.at,
      );
    }
    // Numbers keep counting, so a message's number never changes when older ones go.
    store.db.run(
      "DELETE FROM chat_messages WHERE workspace_id = ? AND number <= ?",
      workspaceId,
      last + added.length - CHAT_MESSAGES_KEPT,
    );
    return added;
  });
}
