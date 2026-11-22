import { useState, type ReactNode } from "react";
import { HostIcon } from "./HostIcon.tsx";
import { t } from "./i18n/translate.ts";
import type { Progress } from "./progress.ts";

// Where the person says what they need (GEN-01): the ask bar, one rounded bar with the field, the
// way into the conversation and a send button (APP-01, the redesign's a-focus mockup), the start
// of the chat (#132). It is offered only once the setup check passes (PLAT-03). Whether a request
// is running is the app's to know, not this box's, so leaving the screen and coming back doesn't
// let a second one in while the first runs. The field keeps one line's height, so typing never
// changes the layout around it (APP-01); Shift+Enter still starts a new line, which scrolls.

type Props = {
  /** True while a request runs: the box says so and takes no other. */
  working: boolean;
  /**
   * The running request's stage and elapsed time (GEN-16). The stage is the status a screen
   * reader announces when it changes; the seconds sit beside it, outside the live region, so they
   * aren't read out every second.
   */
  progress?: Progress;
  /** Carries out the request; resolves when the app has said what happened. */
  onRequest: (request: string) => Promise<void>;
  /** The field's hint: an example tool by default, or asking for a change while a tool is open. */
  placeholder?: string;
  /** The control that opens the conversation, shown inside the bar before send. */
  conversation?: ReactNode;
};

export function RequestBox({ working, progress, onRequest, placeholder, conversation }: Props) {
  const [request, setRequest] = useState("");
  const send = async () => {
    const text = request.trim();
    if (!text || working) return;
    await onRequest(text);
    setRequest("");
  };
  return (
    <div className="request">
      <div className="ask-bar">
        <HostIcon name="chat" />
        <label htmlFor="request" className="visually-hidden">
          {t("request.label")}
        </label>
        <textarea
          id="request"
          rows={1}
          value={request}
          placeholder={placeholder ?? t("request.placeholder")}
          disabled={working}
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter starts a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {conversation}
        <button
          type="button"
          className="primary icon-button ask-send"
          aria-label={t("request.send")}
          title={t("request.send")}
          disabled={working}
          onClick={() => void send()}
        >
          <HostIcon name="send" />
        </button>
      </div>
      <div className="request-progress">
        <p role="status">{working ? (progress?.status ?? t("request.working")) : ""}</p>
        {working && progress && <p className="request-elapsed">{progress.elapsed}</p>}
      </div>
    </div>
  );
}
