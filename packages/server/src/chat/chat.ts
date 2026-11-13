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
// takes no more; removing it for good removes the chat with it. Exports never read these tables.
// What was said with no tool open is kept too, in the empty screen's own chat (A62). Every kept
// message is searchable by its words within its own chat (A62).

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

/**
 * Where a chat is kept: a workspace's, or, with none (`null`), the empty screen's. A workspace must
 * exist and not be in the trash; the empty screen's always does.
 */
function thread(store: Store, workspaceId: string | null) {
  if (workspaceId === null)
    return { table: "home_chat_messages", where: "1 = 1", params: [] as string[], search: "" };
  existingWorkspace(store, workspaceId);
  return {
    table: "chat_messages",
    where: "workspace_id = ?",
    params: [workspaceId],
    search: workspaceId,
  };
}

/**
 * The kept messages, oldest first: a workspace's, or the empty screen's with `null`. Refused if
 * the workspace is missing or in the trash.
 */
export function listChat(store: Store, workspaceId: string | null): ChatMessage[] {
  const { table, where, params } = thread(store, workspaceId);
  return store.db
    .all(
      messageRow,
      `SELECT number, speaker, text, added_at FROM ${table} WHERE ${where} ORDER BY number`,
      ...params,
    )
    .map(asMessage);
}

/**
 * Adds messages to the end of a chat, a workspace's or the empty screen's (`null`), in order, and
 * lets the oldest go past `CHAT_MESSAGES_KEPT`. Refused if the workspace is missing or in the
 * trash. Returns them as kept.
 */
export function addToChat(
  store: Store,
  workspaceId: string | null,
  entries: readonly ChatEntry[],
): ChatMessage[] {
  return store.db.transaction(() => {
    const { table, where, params } = thread(store, workspaceId);
    const last =
      store.db.get(
        z.object({ last: z.number().nullable() }),
        `SELECT MAX(number) AS last FROM ${table} WHERE ${where}`,
        ...params,
      )?.last ?? 0;
    const at = store.now().toISOString();
    const added = entries.map((entry, index): ChatMessage => ({
      ...entry,
      number: last + index + 1,
      at,
    }));
    for (const message of added) {
      if (workspaceId === null)
        store.db.run(
          "INSERT INTO home_chat_messages (number, speaker, text, added_at) VALUES (?, ?, ?, ?)",
          message.number,
          message.from,
          message.text,
          message.at,
        );
      else
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
      `DELETE FROM ${table} WHERE ${where} AND number <= ?`,
      ...params,
      last + added.length - CHAT_MESSAGES_KEPT,
    );
    return added;
  });
}

/** How many messages a search gives at most. */
export const CHAT_SEARCH_LIMIT = 5;

/**
 * Words too common to tell one message from another, in the languages Tessera is most used in;
 * the ranking weighs the rest. A word of two letters or fewer never counts either.
 */
const COMMON_WORDS = new Set([
  // English
  "the",
  "and",
  "for",
  "you",
  "are",
  "was",
  "were",
  "what",
  "that",
  "this",
  "these",
  "those",
  "with",
  "from",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "will",
  "just",
  "not",
  "but",
  "all",
  "any",
  "some",
  "one",
  "more",
  "please",
  "now",
  "then",
  "there",
  "here",
  "into",
  "out",
  "about",
  "them",
  "they",
  "their",
  "its",
  "it's",
  "our",
  "your",
  "yours",
  "mine",
  "make",
  "made",
  "want",
  "need",
  "like",
  "let",
  "lets",
  "also",
  "too",
  "very",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "do",
  "does",
  "did",
  "done",
  "get",
  "got",
  "put",
  "add",
  // Portuguese
  "que",
  "com",
  "para",
  "por",
  "uma",
  "umas",
  "uns",
  "dos",
  "das",
  "nos",
  "nas",
  "não",
  "nao",
  "mais",
  "isso",
  "isto",
  "esse",
  "essa",
  "este",
  "esta",
  "aqui",
  "ali",
  "agora",
  "então",
  "entao",
  "também",
  "tambem",
  "como",
  "quando",
  "onde",
  "qual",
  "quais",
  "faz",
  "fazer",
  "pode",
  "favor",
  "quero",
  "preciso",
  "coloca",
  "coloque",
  "meu",
  "minha",
  "seu",
  "sua",
  "ele",
  "ela",
  "eles",
  "elas",
  "foi",
  "são",
  "sao",
  "está",
  "esta",
  "estão",
  // Spanish
  "los",
  "las",
  "del",
  "una",
  "unos",
  "para",
  "pero",
  "más",
  "esto",
  "eso",
  "ese",
  "esa",
  "aquí",
  "ahora",
  "también",
  "cómo",
  "cuándo",
  "dónde",
  "hacer",
  "quiero",
]);

/**
 * The words of a text worth searching for: letters and digits in any script, without case, two
 * letters or fewer and common words left out, each once.
 */
export function searchWords(text: string): string[] {
  const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return [...new Set(words.filter((word) => word.length > 2 && !COMMON_WORDS.has(word)))];
}

const searchRow = z.object({ number: z.number() });

/**
 * The messages of a chat, a workspace's or the empty screen's (`null`), that share the most
 * telling words with `text`, best first, at most `limit`, leaving out those numbered `skip`. Each
 * word is searched as a quoted string, so nothing in the text can act as search syntax. Refused if
 * the workspace is missing or in the trash.
 */
export function searchChat(
  store: Store,
  workspaceId: string | null,
  text: string,
  options: { limit?: number; skip?: readonly number[] } = {},
): ChatMessage[] {
  const { search, table, where, params } = thread(store, workspaceId);
  const words = searchWords(text);
  if (words.length === 0) return [];
  const query = words.map((word) => `"${word.replaceAll('"', '""')}"`).join(" OR ");
  const skip = new Set(options.skip ?? []);
  const limit = options.limit ?? CHAT_SEARCH_LIMIT;
  const found = store.db
    .all(
      searchRow,
      "SELECT number FROM chat_search WHERE chat_search MATCH ? AND thread = ? ORDER BY bm25(chat_search) LIMIT ?",
      query,
      search,
      limit + skip.size,
    )
    .map((row) => row.number)
    .filter((number) => !skip.has(number))
    .slice(0, limit);
  if (found.length === 0) return [];
  const rows = store.db.all(
    messageRow,
    `SELECT number, speaker, text, added_at FROM ${table} WHERE ${where} AND number IN (${found.map(() => "?").join(", ")})`,
    ...params,
    ...found,
  );
  const byNumber = new Map(rows.map((row) => [row.number, asMessage(row)]));
  return found.flatMap((number) => byNumber.get(number) ?? []);
}
