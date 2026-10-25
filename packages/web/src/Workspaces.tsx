import type { SavedTool, Workspace } from "@tessera/contracts";
import { useState } from "react";
import { t } from "./i18n/translate.ts";

// The workspaces list (APP-03): each workspace with its name, when it was last used and whether
// it is saved to the library, with switching, renaming and deleting to the trash.

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

type Props = {
  workspaces: readonly Workspace[];
  savedTools: readonly SavedTool[];
  openId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function Workspaces({ workspaces, savedTools, openId, onOpen, onRename, onDelete }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const saved = new Set(savedTools.map((tool) => tool.workspaceId));

  return (
    <section aria-labelledby="workspaces-heading" className="workspaces">
      <h2 id="workspaces-heading">{t("workspaces.heading")}</h2>
      <ul>
        {workspaces.map((workspace) => {
          const name = workspace.title;
          const isOpen = workspace.id === openId;
          return (
            <li key={workspace.id} className={isOpen ? "workspace open" : "workspace"}>
              {renaming === workspace.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onRename(workspace.id, draft).then(() => setRenaming(null));
                  }}
                >
                  <label htmlFor={`rename-${workspace.id}`}>
                    {t("workspaces.renameLabel", { name })}
                  </label>
                  <input
                    id={`rename-${workspace.id}`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={200}
                    required
                    autoFocus
                  />
                  <button type="submit">{t("workspaces.renameSave")}</button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    {t("workspaces.renameCancel")}
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="workspace-name"
                    aria-current={isOpen ? "true" : undefined}
                    aria-label={
                      isOpen ? t("workspaces.opened", { name }) : t("workspaces.open", { name })
                    }
                    onClick={() => onOpen(workspace.id)}
                  >
                    <span>{name}</span>
                    <span className="detail">
                      {t("workspaces.lastUsed", {
                        when: when.format(new Date(workspace.updatedAt)),
                      })}
                    </span>
                    {saved.has(workspace.id) && (
                      <span className="badge">{t("workspaces.saved")}</span>
                    )}
                  </button>
                  <div className="actions">
                    <button
                      type="button"
                      aria-label={t("workspaces.rename", { name })}
                      onClick={() => {
                        setDraft(name);
                        setRenaming(workspace.id);
                      }}
                    >
                      {t("workspaces.renameShort")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("workspaces.delete", { name })}
                      onClick={() => void onDelete(workspace.id)}
                    >
                      {t("workspaces.deleteShort")}
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
