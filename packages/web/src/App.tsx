import type { SavedTool, Workspace } from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask } from "./host-api.ts";
import { t } from "./i18n/translate.ts";
import { Library } from "./Library.tsx";
import { ToolPanel } from "./ToolPanel.tsx";
import { Workspaces } from "./Workspaces.tsx";

// The host's main screen (APP-01, APP-02, APP-03): the workspaces beside the open workspace's
// tool. With no workspaces it invites the person to describe what they need, with no example
// tools (A12). The chat that makes tools comes with M2.

/** The first-run screen, shown while there are no workspaces (APP-02). */
export function EmptyState() {
  return (
    <main className="empty">
      <h1>{t("home.heading")}</h1>
      <p>{t("home.intro")}</p>
      <p role="status">{t("home.status")}</p>
    </main>
  );
}

// Which workspace is open is kept for this tab, so a reload opens it again (UX-07).
const OPEN_KEY = "tessera.openWorkspace";
const remembered = () => {
  try {
    return sessionStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
};
const remember = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(OPEN_KEY, id);
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage can be off; the app still works, it just doesn't remember.
  }
};

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [savedTools, setSavedTools] = useState<SavedTool[]>([]);
  const [openId, setOpenId] = useState<string | null>(remembered);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"workspaces" | "library">("workspaces");

  const refresh = async () => {
    const [list, library] = await Promise.all([
      ask("workspaces.list", {}),
      ask("library.list", {}),
    ]);
    setWorkspaces(list.workspaces);
    setSavedTools(library.savedTools);
    return list.workspaces;
  };
  const report = (error: unknown) =>
    setNotice(
      t("app.problem", { message: error instanceof Error ? error.message : String(error) }),
    );

  useEffect(() => {
    let current = true;
    Promise.all([ask("workspaces.list", {}), ask("library.list", {})]).then(
      ([list, library]) => {
        if (!current) return;
        setWorkspaces(list.workspaces);
        setSavedTools(library.savedTools);
        // Open the remembered workspace if it is still there, or else the most recent one.
        const start = list.workspaces.find((w) => w.id === remembered()) ?? list.workspaces[0];
        setOpenId(start?.id ?? null);
      },
      (error: unknown) => {
        if (current) report(error);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const open = (id: string | null) => {
    setOpenId(id);
    remember(id);
  };

  if (workspaces === null) {
    return (
      <main>
        <p role="status">{notice || t("app.loading")}</p>
      </main>
    );
  }
  if (workspaces.length === 0) return <EmptyState />;
  const current = workspaces.find((w) => w.id === openId) ?? null;

  // Runs an action, then reloads the lists; says `done` when it worked, or why it didn't.
  const act = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      await refresh();
      setNotice(done ?? "");
    } catch (error) {
      report(error);
    }
  };
  const showWorkspace = (id: string) => {
    open(id);
    setView("workspaces");
  };

  return (
    <div className={view === "library" ? "app library-view" : "app"}>
      <header>
        <h1>{t("app.title")}</h1>
        <nav aria-label={t("nav.label")} className="sections">
          <button
            type="button"
            aria-current={view === "workspaces" ? "page" : undefined}
            onClick={() => setView("workspaces")}
          >
            {t("nav.workspaces")}
          </button>
          <button
            type="button"
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            {t("nav.library")}
          </button>
        </nav>
      </header>
      {view === "workspaces" ? (
        <>
          <aside>
            <Workspaces
              workspaces={workspaces}
              savedTools={savedTools}
              openId={openId}
              onOpen={open}
              onRename={(id, title) => act(() => ask("workspaces.rename", { id, title }))}
              onSave={(id, name) =>
                act(
                  () => ask("library.save", { workspaceId: id, name }),
                  t("workspaces.savedAs", { name }),
                )
              }
              onDelete={async (id) => {
                const name = workspaces.find((w) => w.id === id)?.title ?? "";
                try {
                  await ask("workspaces.delete", { id });
                  setNotice(t("workspaces.deleted", { name }));
                  const left = await refresh();
                  if (id === openId) open(left[0]?.id ?? null);
                } catch (error) {
                  report(error);
                }
              }}
            />
          </aside>
          <main>{current && <ToolPanel key={current.id} workspace={current} />}</main>
        </>
      ) : (
        <main>
          <Library
            savedTools={savedTools}
            workspaces={workspaces}
            onContinue={async (tool) => {
              try {
                // Continue opens exactly the linked workspace (DATA-07).
                const { workspace } = await ask("library.continue", { id: tool.id });
                showWorkspace(workspace.id);
              } catch (error) {
                report(error);
              }
            }}
            onUseAgain={async (tool) => {
              try {
                const result = await ask("library.useAgain", { id: tool.id });
                if (!result.ok) return report(new Error(result.message));
                await refresh();
                setNotice(t("library.usedAgain", { name: tool.name }));
                showWorkspace(result.workspace.id);
              } catch (error) {
                report(error);
              }
            }}
            onSaveAsNew={async (tool, name) => {
              try {
                // A variant: a new workspace from the tool's starting data, saved under its own
                // name, so it changes apart from the original (DATA-08).
                const result = await ask("library.useAgain", { id: tool.id, title: name });
                if (!result.ok) return report(new Error(result.message));
                await ask("library.save", { workspaceId: result.workspace.id, name });
                await refresh();
                setNotice(t("library.savedAsNew", { name }));
              } catch (error) {
                report(error);
              }
            }}
            onRename={(tool, name) => act(() => ask("library.rename", { id: tool.id, name }))}
            onDelete={(tool) =>
              act(
                () => ask("library.delete", { id: tool.id }),
                t("library.deleted", { name: tool.name }),
              )
            }
          />
        </main>
      )}
      <p role="status" className="notice">
        {notice}
      </p>
    </div>
  );
}
