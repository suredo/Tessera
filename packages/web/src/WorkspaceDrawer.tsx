import { useId, type ReactNode, type RefObject } from "react";
import { t } from "./i18n/translate.ts";

// A native modal leaves the running frame mounted and makes the rest of the host inert (APP-01,
// APP-11). The browser contains focus and returns it to the opener on Escape or Close.
type Props = {
  dialog: RefObject<HTMLDialogElement | null>;
  onClose: () => void;
  onNew: () => void;
  onNavigate: (view: "library" | "trash" | "status" | "connections") => void;
  view: "workspaces" | "library" | "trash" | "status" | "connections";
  children: ReactNode;
  footer: ReactNode;
  notice: string;
};

export function WorkspaceDrawer({
  dialog,
  onClose,
  onNew,
  onNavigate,
  view,
  children,
  footer,
  notice,
}: Props) {
  const heading = useId();
  return (
    <dialog
      ref={dialog}
      className="workspace-drawer"
      aria-labelledby={heading}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // Chrome can put focus on the document between the last and first modal controls.
        // Wrap at the boundary so every Tab stays on a control in this drawer (APP-11).
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), [tabindex]",
          ),
        ].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="drawer-heading">
        <h2 id={heading}>{t("workspaces.heading")}</h2>
        <button type="button" onClick={onClose}>
          {t("workspaces.close")}
        </button>
      </div>
      <div className="drawer-content">
        <button type="button" className="primary drawer-new" onClick={onNew}>
          {t("workspaces.new")}
        </button>
        <button
          type="button"
          className="drawer-nav"
          aria-current={view === "library" ? "page" : undefined}
          onClick={() => onNavigate("library")}
        >
          {t("nav.library")}
        </button>
        {children}
        <p role="status">{notice}</p>
      </div>
      <div className="drawer-footer">
        {footer}
        <nav aria-label={t("nav.label")}>
          <button
            type="button"
            aria-current={view === "connections" ? "page" : undefined}
            onClick={() => onNavigate("connections")}
          >
            {t("nav.connections")}
          </button>
          <button
            type="button"
            aria-current={view === "trash" ? "page" : undefined}
            onClick={() => onNavigate("trash")}
          >
            {t("nav.trash")}
          </button>
          <button
            type="button"
            aria-label={t("nav.status")}
            aria-current={view === "status" ? "page" : undefined}
            onClick={() => onNavigate("status")}
          >
            {t("workspaces.setup")}
          </button>
        </nav>
        <p className="detail">{t("tool.kept")}</p>
      </div>
    </dialog>
  );
}
