import { useState } from "react";
import { t } from "./i18n/translate.ts";
import type { Progress } from "./progress.ts";

// Where the person says what they need (GEN-01): a field and a button, the start of the chat
// (#132). It is offered only once the setup check passes (PLAT-03). Whether a request is running
// is the app's to know, not this box's, so leaving the screen and coming back doesn't let a second
// one in while the first runs.

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
};

export function RequestBox({ working, progress, onRequest }: Props) {
  const [request, setRequest] = useState("");
  const send = async () => {
    const text = request.trim();
    if (!text || working) return;
    await onRequest(text);
    setRequest("");
  };
  return (
    <div className="request">
      <label htmlFor="request">{t("request.label")}</label>
      <textarea
        id="request"
        rows={2}
        value={request}
        placeholder={t("request.placeholder")}
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
      <button type="button" className="primary" disabled={working} onClick={() => void send()}>
        {t("request.send")}
      </button>
      <div className="request-progress">
        <p role="status">{working ? (progress?.status ?? t("request.working")) : ""}</p>
        {working && progress && <p className="request-elapsed">{progress.elapsed}</p>}
      </div>
    </div>
  );
}
