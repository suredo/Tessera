import type { SavedTool, Workspace } from "@tessera/contracts";
import { useState } from "react";
import { t } from "./i18n/translate.ts";
import { NameForm } from "./NameForm.tsx";

// My tools, the saved-tools library (APP-04, DATA-07): each saved tool with its name, when it or
// its workspace was last updated and the workspace Continue opens, so the target is clear. Continue goes back to that
// workspace; Use again starts a new one from the tool's starting data; Save as a new tool does the
// same under a new name in the library. Each can be renamed or moved to the trash, and the list
// can be searched by name.

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

type Editing = { id: string; kind: "rename" | "saveAsNew" } | null;

type Props = {
  savedTools: readonly SavedTool[];
  workspaces: readonly Workspace[];
  onContinue: (tool: SavedTool) => Promise<void>;
  onUseAgain: (tool: SavedTool) => Promise<void>;
  onSaveAsNew: (tool: SavedTool, name: string) => Promise<void>;
  onRename: (tool: SavedTool, name: string) => Promise<void>;
  onDelete: (tool: SavedTool) => Promise<void>;
};

export function Library(props: Props) {
  const { savedTools, workspaces } = props;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const linked = new Map(workspaces.map((w) => [w.id, w]));
  const wanted = query.trim().toLocaleLowerCase();
  const shown = savedTools.filter((tool) => tool.name.toLocaleLowerCase().includes(wanted));

  return (
    <section aria-labelledby="library-heading" className="library">
      <h2 id="library-heading">{t("library.heading")}</h2>
      <label htmlFor="library-search">{t("library.search")}</label>
      <input
        id="library-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {savedTools.length === 0 && <p>{t("library.empty")}</p>}
      {savedTools.length > 0 && shown.length === 0 && (
        <p>{t("library.noMatch", { query: query.trim() })}</p>
      )}
      <ul>
        {shown.map((tool) => {
          const name = tool.name;
          const workspace = linked.get(tool.workspaceId)?.title ?? "";
          // A saved tool follows its workspace (A32), so it was updated when either changed last.
          const changed = linked.get(tool.workspaceId)?.updatedAt ?? tool.updatedAt;
          const updated = changed > tool.updatedAt ? changed : tool.updatedAt;
          const done = () => setEditing(null);
          return (
            <li key={tool.id} className="saved-tool">
              <h3>{name}</h3>
              <p className="detail">
                {t("library.updated", { when: when.format(new Date(updated)) })}
              </p>
              <p className="detail">{t("library.continues", { workspace })}</p>
              {editing?.id === tool.id ? (
                <NameForm
                  label={
                    editing.kind === "rename"
                      ? t("library.renameLabel", { name })
                      : t("library.newName")
                  }
                  initial={name}
                  onSubmit={(next) =>
                    (editing.kind === "rename"
                      ? props.onRename(tool, next)
                      : props.onSaveAsNew(tool, next)
                    ).then(done)
                  }
                  onCancel={done}
                />
              ) : (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    aria-label={t("library.continueLabel", { name, workspace })}
                    onClick={() => void props.onContinue(tool)}
                  >
                    {t("library.continue")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("library.useAgainLabel", { name })}
                    onClick={() => void props.onUseAgain(tool)}
                  >
                    {t("library.useAgain")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("library.saveAsNewLabel", { name })}
                    onClick={() => setEditing({ id: tool.id, kind: "saveAsNew" })}
                  >
                    {t("library.saveAsNew")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("library.rename", { name })}
                    onClick={() => setEditing({ id: tool.id, kind: "rename" })}
                  >
                    {t("library.renameShort")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("library.delete", { name })}
                    onClick={() => void props.onDelete(tool)}
                  >
                    {t("library.deleteShort")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
