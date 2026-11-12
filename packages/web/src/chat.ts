// Docs: docs/code/web/package.md
import { CHAT_TEXT_LIMIT, type ChatEntry, type ChatMessage } from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask } from "./host-api.ts";

// The chat's state in the host app (APP-01, APP-03): each workspace's kept messages, and the empty
// screen's, read from the server, and the messages not kept (yet): the request while it runs, and a
// turn on its way to being kept. The server keeps a workspace's chat (ADR 0011), and what was said
// with no tool open (A62); a turn shows at once and is replaced by its kept copy in the same
// update, so nothing flickers.

/** A message as the chat shows it: a kept one has its number; one not kept has none. */
export type ShownMessage = ChatEntry & { number?: number };

/** The empty screen's key: what was said with no workspace open. */
const NONE = "";
const key = (workspaceId: string | null) => workspaceId ?? NONE;

type State = {
  /** Kept messages by workspace, as last read or added. */
  kept: Record<string, readonly ChatMessage[]>;
  /** Messages not kept, by workspace, in order. */
  local: Record<string, readonly ShownMessage[]>;
};

/** Adds kept messages to a workspace's list, once each, in their order. */
export function mergeKept(
  list: readonly ChatMessage[],
  added: readonly ChatMessage[],
): ChatMessage[] {
  const byNumber = new Map(list.map((message) => [message.number, message]));
  for (const message of added) byNumber.set(message.number, message);
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/** A reply as it is kept: the chat keeps at most `CHAT_TEXT_LIMIT` characters of a message. */
export const fitted = (text: string): string =>
  text.length <= CHAT_TEXT_LIMIT ? text : `${text.slice(0, CHAT_TEXT_LIMIT - 1)}…`;

/** What the chat shows for a workspace, or for the empty screen: kept first, then the rest. */
export const shown = (state: State, workspaceId: string | null): ShownMessage[] => [
  ...(state.kept[key(workspaceId)] ?? []),
  ...(state.local[key(workspaceId)] ?? []),
];

/** A running request as the chat shows it, to take back when its reply comes. */
export type Asked = { workspaceId: string | null; message: ShownMessage };

export type Chat = {
  /** What the chat shows for this workspace, or the empty screen's when none is open. */
  messages: (workspaceId: string | null) => ShownMessage[];
  /** Shows the request while it runs, under the workspace open when it was sent. */
  asking: (workspaceId: string | null, request: string) => Asked;
  /**
   * Ends the running request with Tessera's reply, in the workspace it belongs to: the one it
   * made, or the one that was open, or the empty screen's chat with none. It is kept there; if
   * keeping it fails, it is still shown for as long as the page is open.
   */
  answered: (asked: Asked, target: string | null, reply: string) => Promise<void>;
  /** A reply with no request of its own, such as a review's outcome, kept like a turn's. */
  said: (target: string | null, reply: string) => Promise<void>;
};

/** The chat for the open workspace, read again whenever another workspace opens. */
export function useChat(openId: string | null): Chat {
  const [state, setState] = useState<State>({ kept: {}, local: {} });

  useEffect(() => {
    let current = true;
    ask("chat.list", { workspaceId: openId }).then(
      ({ messages }) => {
        if (!current) return;
        setState((s) => ({
          ...s,
          kept: { ...s.kept, [key(openId)]: mergeKept(s.kept[key(openId)] ?? [], messages) },
        }));
      },
      // A chat that can't be read shows what this page has; the workspace itself still opens.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [openId]);

  // Shows `entries` under `target` at once, keeps them, and swaps in the kept copy.
  const keep = async (target: string | null, entries: ChatEntry[], asked?: Asked) => {
    setState((s) => {
      const local = { ...s.local };
      if (asked) {
        local[key(asked.workspaceId)] = (local[key(asked.workspaceId)] ?? []).filter(
          (message) => message !== asked.message,
        );
      }
      local[key(target)] = [...(local[key(target)] ?? []), ...entries];
      return { ...s, local };
    });
    try {
      const { messages } = await ask("chat.add", { workspaceId: target, messages: entries });
      const at = key(target);
      setState((s) => {
        const left = [...(s.local[at] ?? [])];
        for (const entry of entries) {
          const index = left.indexOf(entry);
          if (index >= 0) left.splice(index, 1);
        }
        return {
          kept: { ...s.kept, [at]: mergeKept(s.kept[at] ?? [], messages) },
          local: { ...s.local, [at]: left },
        };
      });
    } catch {
      // Not kept: it stays shown for as long as the page is open.
    }
  };

  return {
    messages: (workspaceId) => shown(state, workspaceId),
    asking: (workspaceId, request) => {
      const message: ShownMessage = { from: "person", text: request };
      setState((s) => ({
        ...s,
        local: {
          ...s.local,
          [key(workspaceId)]: [...(s.local[key(workspaceId)] ?? []), message],
        },
      }));
      return { workspaceId, message };
    },
    answered: (asked, target, reply) =>
      keep(
        target,
        [
          { from: "person", text: asked.message.text },
          { from: "tessera", text: fitted(reply) },
        ],
        asked,
      ),
    said: (target, reply) => keep(target, [{ from: "tessera", text: fitted(reply) }]),
  };
}
