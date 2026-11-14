import { t } from "./i18n/translate.ts";
import type { WriteQuestion as Question } from "./tool-start.ts";

// The question before a tool's first change through a connection (ADR 0015 point 4, A70): where
// it goes and what it sends, in plain words, with the text cut to a few lines and a way to see it
// all. Allowing covers the tool's later changes through that connection; the person can take it
// back later. Every word and control here is the host's, never the tool's.

/** How many lines of the text the question shows before "Show all". */
export const QUESTION_LINES = 5;

const ACTIONS = { POST: "send", PUT: "change", PATCH: "change", DELETE: "delete" } as const;

export function WriteQuestion({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (allowed: boolean) => void;
}) {
  const action = ACTIONS[question.method as keyof typeof ACTIONS] ?? "change";
  const lines = question.body === null ? [] : question.body.split("\n");
  const cut = lines.length > QUESTION_LINES;
  return (
    <section role="alertdialog" aria-label={t("write.label")} className="write-question">
      <h2>
        {t(`write.heading.${action}`, { tool: question.tool, connection: question.connection })}
      </h2>
      <p>{t("write.where", { address: question.address })}</p>
      {question.body === null ? (
        <p>{t("write.nothingSent")}</p>
      ) : question.body === "" ? (
        <p>{t("write.emptyText")}</p>
      ) : (
        <>
          <p>{t("write.what")}</p>
          <pre className="write-text">{lines.slice(0, QUESTION_LINES).join("\n")}</pre>
          {cut && (
            <details>
              <summary>{t("write.showAll", { count: lines.length })}</summary>
              <pre className="write-text">{question.body}</pre>
            </details>
          )}
        </>
      )}
      <p>{t("write.later", { connection: question.connection })}</p>
      <button type="button" onClick={() => onAnswer(true)}>
        {t("write.allow")}
      </button>
      <button type="button" onClick={() => onAnswer(false)}>
        {t("write.dontAllow")}
      </button>
    </section>
  );
}
