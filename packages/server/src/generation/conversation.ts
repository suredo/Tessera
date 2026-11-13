// Docs: docs/code/server/generation.md
import type { ChatMessage } from "@tessera/contracts";
import { listChat, searchChat } from "../chat/index.ts";
import { CONVERSATION_MAX_QUOTED } from "../prompts/index.ts";
import type { Store } from "../workspaces/index.ts";

// The conversation a request is told (A62): from its subject's chat, the open workspace's or, with
// none, the empty screen's, the last exchange, always, since "that" and "it" share no words with
// what they mean, and the earlier messages that share the most telling words with the request. It
// is quoted as JSON, one line, within `CONVERSATION_MAX_QUOTED`: the earlier messages go first,
// worst match first, and then the last exchange's longest text is shortened, with a mark.

/** How many earlier messages, besides the last exchange, a request is told at most. */
export const CONVERSATION_EARLIER = 3;

type Told = { from: ChatMessage["from"]; text: string };
const told = (message: ChatMessage): Told => ({ from: message.from, text: message.text });
const MARK = "…";

/**
 * The conversation before `request` in its subject, quoted as JSON, or undefined when there is
 * none, or the workspace is gone or in the trash. Never longer than `CONVERSATION_MAX_QUOTED`.
 */
export function requestConversation(
  store: Store,
  workspaceId: string | null,
  request: string,
): string | undefined {
  let messages: ChatMessage[];
  try {
    messages = listChat(store, workspaceId);
  } catch {
    return undefined;
  }
  if (messages.length === 0) return undefined;
  const last = messages.slice(-2);
  const earlier = searchChat(store, workspaceId, request, {
    limit: CONVERSATION_EARLIER,
    skip: last.map((message) => message.number),
  });
  return fitConversation(
    last.map(told),
    earlier.map((message) => ({ ...told(message), number: message.number })),
  );
}

/**
 * The conversation as told, within `CONVERSATION_MAX_QUOTED`: the earlier messages in the order
 * they were said, after dropping the worst matches that don't fit, then the last exchange, its
 * longest text shortened with a mark until it fits. Undefined if even that can't.
 */
export function fitConversation(
  last: readonly Told[],
  earlier: readonly (Told & { number: number })[],
  limit = CONVERSATION_MAX_QUOTED,
): string | undefined {
  const quote = (now: readonly Told[], before: readonly (Told & { number: number })[]) =>
    JSON.stringify({
      ...(before.length
        ? {
            earlier: [...before]
              .sort((a, b) => a.number - b.number)
              .map(({ from, text }) => ({ from, text })),
          }
        : {}),
      last: now,
    });
  let kept = [...earlier];
  const now = last.map((message) => ({ ...message }));
  while (kept.length > 0 && quote(now, kept).length > limit) kept = kept.slice(0, -1);
  while (quote(now, kept).length > limit) {
    const longest = now.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    if (longest.text.length <= MARK.length + 1) return undefined;
    const over = quote(now, kept).length - limit;
    const keep = Math.max(1, longest.text.length - over - MARK.length - 8);
    longest.text = `${longest.text.slice(0, keep).trimEnd()}${MARK}`;
  }
  return quote(now, kept);
}
