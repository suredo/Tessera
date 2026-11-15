import type { SaveType } from "@tessera/contracts";
import type { MessageKey } from "./i18n/en.ts";
import { t } from "./i18n/translate.ts";
import { formatBytes } from "./setup.ts";
import type { SaveQuestion as Question } from "./tool-start.ts";

// The question before a tool's file is saved (CAP-03, A81): which tool offers it, the file's
// name, its kind and size, in plain words, with Save and Don't save. Only on Save does the host
// page hand the file to the browser. Every word and control here is the host's, never the tool's.

// Each kind a tool may offer, in the person's words.
const KINDS = {
  "image/png": "save.kind.png",
  "image/jpeg": "save.kind.jpeg",
  "image/webp": "save.kind.webp",
  "text/csv": "save.kind.csv",
  "text/plain": "save.kind.text",
  "application/json": "save.kind.json",
} as const satisfies Record<SaveType, MessageKey>;

export function SaveQuestion({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (save: boolean) => void;
}) {
  return (
    <section role="alertdialog" aria-label={t("save.label")} className="write-question">
      <h2>{t("save.heading", { tool: question.tool })}</h2>
      <p>
        {t("save.what", {
          name: question.name,
          kind: t(KINDS[question.type]),
          size: formatBytes(question.sizeBytes),
        })}
      </p>
      <p>{t("save.where")}</p>
      <button type="button" onClick={() => onAnswer(true)}>
        {t("save.save")}
      </button>
      <button type="button" onClick={() => onAnswer(false)}>
        {t("save.dontSave")}
      </button>
    </section>
  );
}
