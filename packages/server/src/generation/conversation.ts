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

type Told = { from: ChatMessage["from"]; text: string; number?: number };
const told = (message: ChatMessage): Told => ({
  from: message.from,
  text: message.text,
  number: message.number,
});

/** What a request was told, for the ledger (A62): its subject and the chat messages' numbers. */
export type ToldConversation = { workspaceId: string | null; numbers: number[] };
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
  return conversationFor(store, workspaceId, request)?.quoted;
}

/**
 * The conversation before `request`, quoted as `requestConversation` gives it, with what it is
 * made of, for the ledger: no words, only where they are kept (A62, ENG-16).
 */
export function conversationFor(
  store: Store,
  workspaceId: string | null,
  request: string,
): { quoted: string; told: ToldConversation } | undefined {
  let messages: ChatMessage[];
  try {
    messages = listChat(store, workspaceId);
  } catch {
    return undefined;
  }
  if (messages.length === 0) return undefined;
  const last = lastExchange(messages);
  const earlier = searchChat(store, workspaceId, request, {
    limit: CONVERSATION_EARLIER,
    skip: last.map((message) => message.number),
  });
  let kept: number[] = [];
  const fitted = fitConversation(
    last.map(told),
    earlier.map((message) => ({ ...told(message), number: message.number })),
    CONVERSATION_MAX_QUOTED,
    (numbers) => (kept = numbers),
  );
  return fitted === undefined
    ? undefined
    : { quoted: fitted, told: { workspaceId, numbers: kept.sort((a, b) => a - b) } };
}

/**
 * The last exchange: the person's last request and at most the two replies after it, such as a
 * review's reply and then the outcome of its buttons, so the request is never lost behind replies
 * of their own (A62). With no request of the person's kept, the last two messages.
 */
export function lastExchange(messages: readonly ChatMessage[]): ChatMessage[] {
  const asked = messages.findLastIndex((message) => message.from === "person");
  if (asked < 0) return messages.slice(-2);
  return [messages[asked]!, ...messages.slice(asked + 1).slice(-2)];
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
  /** Given the numbers of the messages told, when they fit. */
  numbered?: (numbers: number[]) => void,
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
      last: now.map(({ from, text }) => ({ from, text })),
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
  numbered?.(
    [...kept, ...now].flatMap((message) => (message.number === undefined ? [] : [message.number])),
  );
  return quote(now, kept);
}
