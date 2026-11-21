import type { SavedTool, Workspace } from "@tessera/contracts";
import { useId, useRef, useState } from "react";
import { NameForm } from "./NameForm.tsx";
import { t } from "./i18n/translate.ts";

// The open tool's actions, shared with the existing workspace/library operations (APP-03, DATA-08).
// Native popovers dismiss with Escape and return focus without rebuilding the running tool.
function NameAction({
  label,
  field,
  initial,
  onSubmit,
}: {
  label: string;
  field: string;
  initial: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  return (
    <>
      <button type="button" popoverTarget={id}>
        {label}
      </button>
      <div
        id={id}
        popover="auto"
        ref={panel}
        className="host-panel name-panel"
        role="dialog"
        aria-label={label}
        onToggle={(event) => setShown(event.newState === "open")}
      >
        {shown && (
          <NameForm
            label={field}
            initial={initial}
            onSubmit={async (name) => {
              await onSubmit(name);
              panel.current?.hidePopover();
            }}
            onCancel={() => panel.current?.hidePopover()}
          />
        )}
      </div>
    </>
  );
}

type Props = {
  workspace: Workspace;
  savedTool?: SavedTool;
  kind: "save" | "menu";
  onRename: (name: string) => Promise<void>;
  onSave: (name: string) => Promise<void>;
  onSaveAsNew: (tool: SavedTool, name: string) => Promise<void>;
  onExport: () => Promise<void>;
  onTrash: () => Promise<void>;
};

export function WorkspaceActions({
  workspace,
  savedTool,
  kind,
  onRename,
  onSave,
  onSaveAsNew,
  onExport,
  onTrash,
}: Props) {
  const name = workspace.title;
  if (kind === "save")
    return (
      <span className="save-tool">
        <NameAction
          label={t("workspaces.saveShort")}
          field={t("workspaces.saveLabel")}
          initial={name}
          onSubmit={onSave}
        />
      </span>
    );
  return (
    <>
      <span className="menu-save-tool">
        <NameAction
          label={t("workspaces.saveShort")}
          field={t("workspaces.saveLabel")}
          initial={name}
          onSubmit={onSave}
        />
      </span>
      <NameAction
        label={t("workspaces.renameShort")}
        field={t("workspaces.renameLabel", { name })}
        initial={name}
        onSubmit={onRename}
      />
      {savedTool && (
        <NameAction
          label={t("library.saveAsNew")}
          field={t("library.saveAsNewLabel", { name })}
          initial={name}
          onSubmit={(next) => onSaveAsNew(savedTool, next)}
        />
      )}
      <button type="button" onClick={() => void onExport()}>
        {t("workspaces.exportShort")}
      </button>
      <button type="button" onClick={() => void onTrash()}>
        {t("workspaces.deleteShort")}
      </button>
    </>
  );
}
