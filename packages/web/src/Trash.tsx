import type { Trash as TrashList, TrashEntry } from "@tessera/contracts";
import { useState } from "react";
import { t } from "./i18n/translate.ts";

// The trash (APP-08, DATA-09): deleted workspaces and saved tools, each with when it goes for
// good, and restore. Emptying it early first names everything it will remove, and is confirmed
// against exactly that list: if the trash changed meanwhile, the server refuses it.

const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const at = (time: string) => day.format(new Date(time));

type Props = {
  trash: TrashList;
  onRestore: (entry: TrashEntry) => Promise<void>;
  /** Empties exactly the entries the confirmation names. */
  onEmpty: (confirmation: string) => Promise<void>;
};

const kindText = (entry: TrashEntry) =>
  entry.kind === "workspace"
    ? entry.savedTools.length > 0
      ? t("trash.workspaceWithTools", { tools: entry.savedTools.join(", ") })
      : t("trash.workspace")
    : t("trash.savedTool");

export function Trash({ trash, onRestore, onEmpty }: Props) {
  const [confirming, setConfirming] = useState(false);
  const { entries } = trash;

  return (
    <section aria-labelledby="trash-heading" className="trash">
      <h2 id="trash-heading">{t("trash.heading")}</h2>
      <p>{t("trash.intro")}</p>
      {entries.length === 0 && <p>{t("trash.empty")}</p>}
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.kind}:${entry.id}`} className="trash-entry">
            <h3>{entry.name}</h3>
            <p className="detail">{kindText(entry)}</p>
            <p className="detail">
              {t("trash.dates", { deleted: at(entry.deletedAt), removed: at(entry.removedAt) })}
            </p>
            <button
              type="button"
              aria-label={t("trash.restoreLabel", { name: entry.name })}
              onClick={() => void onRestore(entry)}
            >
              {t("trash.restore")}
            </button>
          </li>
        ))}
      </ul>
      {entries.length > 0 && !confirming && (
        <button type="button" onClick={() => setConfirming(true)}>
          {t("trash.emptyNow")}
        </button>
      )}
      {confirming && entries.length > 0 && (
        <div role="group" aria-labelledby="empty-heading" className="confirm">
          <h3 id="empty-heading">{t("trash.confirmHeading")}</h3>
          <p>{t("trash.confirmIntro")}</p>
          <ul>
            {entries.map((entry) => (
              <li key={`${entry.kind}:${entry.id}`}>
                {t("trash.confirmEntry", { name: entry.name, kind: kindText(entry) })}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="primary"
            onClick={() => void onEmpty(trash.confirmation).then(() => setConfirming(false))}
          >
            {t("trash.confirm")}
          </button>{" "}
          <button type="button" onClick={() => setConfirming(false)}>
            {t("trash.cancel")}
          </button>
        </div>
      )}
    </section>
  );
}
