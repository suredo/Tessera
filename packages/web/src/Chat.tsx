import { useEffect, useRef, type ReactNode } from "react";
import type { ShownMessage } from "./chat.ts";
import { t } from "./i18n/translate.ts";

// The chat (APP-01, APP-03): the open workspace's conversation, what the person asked and what
// Tessera answered, with the request box under it. A log, so a screen reader reads each new
// message as it comes, Tessera's replies included, once (GEN-08); the request's progress stays
// the request box's own status.

type Props = {
  messages: readonly ShownMessage[];
  /** The request box, and anything else under the conversation, such as Cancel. */
  children?: ReactNode;
};

export function Chat({ messages, children }: Props) {
  const end = useRef<HTMLLIElement>(null);
  // The newest message in view, without moving the page around it.
  const newest = messages.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [newest]);
  return (
    <section className="chat" aria-label={t("chat.label")}>
      <ol className="chat-log" role="log" aria-label={t("chat.log")}>
        {messages.map((message, index) => (
          <li
            key={message.number ?? `local-${index}`}
            ref={index === messages.length - 1 ? end : undefined}
            className={message.from === "person" ? "from-person" : "from-tessera"}
          >
            <span className="chat-speaker">
              {message.from === "person" ? t("chat.you") : t("chat.tessera")}
            </span>
            <p className="chat-text">{message.text}</p>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}
