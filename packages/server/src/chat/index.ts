// Docs: docs/code/server/chat.md
// A workspace's chat, kept with it, and the empty screen's; searchable by its words (APP-01, APP-03, A62).
export { addToChat, CHAT_SEARCH_LIMIT, listChat, searchChat, searchWords } from "./chat.ts";
export type { ChatEntry, ChatMessage } from "@tessera/contracts";
