import type { SavedTool, Workspace } from "@tessera/contracts";
import { useId, useState } from "react";
import { HostIcon } from "./HostIcon.tsx";
import { t } from "./i18n/translate.ts";
import { NameForm } from "./NameForm.tsx";

// The workspaces list (APP-03): each workspace with its name, when it was last used and whether
// it is saved to the library, with switching, renaming, saving to my tools (DATA-08), exporting
// to a file (APP-06) and deleting to the trash.

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

type Editing = { id: string; kind: "rename" | "save" } | null;

type Props = {
  workspaces: readonly Workspace[];
  savedTools: readonly SavedTool[];
  /** When each was last used, by ID: opened or changed, whichever is later. */
  lastUsed: Readonly<Record<string, string>>;
  openId: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onSave: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Exports the workspace, with its saved tools, to a file (APP-06). */
  onExport: (id: string) => Promise<void>;
};

export function Workspaces(props: Props) {
  const { workspaces, savedTools, lastUsed, openId } = props;
  const [editing, setEditing] = useState<Editing>(null);
  const searchId = useId();
  const [query, setQuery] = useState("");
  const wanted = query.trim().toLocaleLowerCase();
  const shown = workspaces.filter((workspace) =>
    workspace.title.toLocaleLowerCase().includes(wanted),
  );
  const saved = new Set(savedTools.map((tool) => tool.workspaceId));

  return (
    <section aria-label={t("workspaces.heading")} className="workspaces">
      <h2>{t("workspaces.recent")}</h2>
      <label className="visually-hidden" htmlFor={searchId}>
        {t("workspaces.find")}
      </label>
      <input
        id={searchId}
        type="search"
        placeholder={t("workspaces.find")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {shown.length === 0 && wanted && <p>{t("workspaces.noMatch", { query: query.trim() })}</p>}
      <ul>
        {shown.map((workspace) => {
          const name = workspace.title;
          const isOpen = workspace.id === openId;
          const done = () => setEditing(null);
          return (
            <li key={workspace.id} className={isOpen ? "workspace open" : "workspace"}>
              {editing?.id === workspace.id ? (
                <NameForm
                  label={
                    editing.kind === "rename"
                      ? t("workspaces.renameLabel", { name })
                      : t("workspaces.saveLabel")
                  }
                  initial={name}
                  confirm={
                    editing.kind === "rename" ? "workspaces.renameSave" : "workspaces.saveConfirm"
                  }
                  onSubmit={(next) =>
                    (editing.kind === "rename"
                      ? props.onRename(workspace.id, next)
                      : props.onSave(workspace.id, next)
                    ).then(done)
                  }
                  onCancel={done}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="workspace-name"
                    aria-current={isOpen ? "true" : undefined}
                    aria-label={
                      isOpen ? t("workspaces.opened", { name }) : t("workspaces.open", { name })
                    }
                    onClick={() => props.onOpen(workspace.id)}
                  >
                    <span>{name}</span>
                    <span className="detail">
                      {t("workspaces.lastUsed", {
                        when: when.format(new Date(lastUsed[workspace.id] ?? workspace.updatedAt)),
                      })}
                    </span>
                    {saved.has(workspace.id) && (
                      <span className="badge">{t("workspaces.saved")}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-button workspace-more"
                    aria-label={t("workspaces.actions", { name })}
                    popoverTarget={`workspace-actions-${workspace.id}`}
                  >
                    <HostIcon name="more" />
                  </button>
                  <div
                    id={`workspace-actions-${workspace.id}`}
                    popover="auto"
                    className="workspace-menu"
                  >
                    {workspace.currentVersion !== null && (
                      <button
                        type="button"
                        aria-label={t("workspaces.save", { name })}
                        onClick={() => setEditing({ id: workspace.id, kind: "save" })}
                      >
                        {t("workspaces.saveShort")}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t("workspaces.rename", { name })}
                      onClick={() => setEditing({ id: workspace.id, kind: "rename" })}
                    >
                      {t("workspaces.renameShort")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("workspaces.export", { name })}
                      onClick={() => void props.onExport(workspace.id)}
                    >
                      {t("workspaces.exportShort")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("workspaces.delete", { name })}
                      onClick={() => void props.onDelete(workspace.id)}
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
