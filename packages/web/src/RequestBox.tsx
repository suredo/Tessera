import { useState } from "react";
import { t } from "./i18n/translate.ts";

// Where the person says what they need (GEN-01): a field and a button, the start of the chat
// (#132). It is offered only once the setup check passes (PLAT-03), and while a request runs it
// says so and takes no other.

type Props = {
  /** Carries out the request; resolves when the app has said what happened. */
  onRequest: (request: string) => Promise<void>;
};

export function RequestBox({ onRequest }: Props) {
  const [request, setRequest] = useState("");
  const [working, setWorking] = useState(false);
  const send = async () => {
    const text = request.trim();
    if (!text || working) return;
    setWorking(true);
    try {
      await onRequest(text);
      setRequest("");
    } finally {
      setWorking(false);
    }
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
      <p role="status">{working ? t("request.working") : ""}</p>
    </div>
  );
}
