import type { SavedTool, Trash as TrashList, Workspace } from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask } from "./host-api.ts";
import { t } from "./i18n/translate.ts";
import { History } from "./History.tsx";
import { Library } from "./Library.tsx";
import { ToolPanel } from "./ToolPanel.tsx";
import { Trash } from "./Trash.tsx";
import { Workspaces } from "./Workspaces.tsx";

// The host's main screen (APP-01, APP-02, APP-03): the workspaces beside the open workspace's
// tool. With no workspaces it invites the person to describe what they need, with no example
// tools (A12). The chat that makes tools comes with M2.

/** The first-run screen, shown while there are no workspaces (APP-02). */
export function EmptyState({ notice = "", onTrash }: { notice?: string; onTrash?: () => void }) {
  return (
    <main className="empty">
      <h1>{t("home.heading")}</h1>
      <p>{t("home.intro")}</p>
      <p role="status">{t("home.status")}</p>
      {/* Such as the trash notice after the last workspace is deleted. */}
      <p role="status">{notice}</p>
      {/* What was deleted can still come back from here (DATA-09). */}
      {onTrash && (
        <button type="button" onClick={onTrash}>
          {t("home.trash")}
        </button>
      )}
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

// The most recently used first: opened or changed, whichever is later (APP-03).
const byUse = (list: readonly Workspace[], used: Record<string, string>) =>
  [...list].sort((a, b) => (used[b.id] ?? b.updatedAt).localeCompare(used[a.id] ?? a.updatedAt));

// A list from the server, in the order already shown: rows keep their place while the person
// works, so nothing moves under a click or takes the keyboard focus with it. New ones come first.
const inPlace = (shown: readonly Workspace[] | null, list: readonly Workspace[]) => {
  const place = new Map((shown ?? []).map((w, index) => [w.id, index]));
  return [...list].sort((a, b) => (place.get(a.id) ?? -1) - (place.get(b.id) ?? -1));
};

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [savedTools, setSavedTools] = useState<SavedTool[]>([]);
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(remembered);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"workspaces" | "library" | "trash">("workspaces");
  const [trash, setTrash] = useState<TrashList | null>(null);
  // Moved on after a restore or an undo, so the tool starts again with the changed data.
  const [reloads, setReloads] = useState(0);

  const refresh = async () => {
    const [list, library, deleted] = await Promise.all([
      ask("workspaces.list", {}),
      ask("library.list", {}),
      ask("trash.list", {}),
    ]);
    setTrash(deleted);
    const ordered = inPlace(workspaces, list.workspaces);
    setWorkspaces(ordered);
    setLastUsed(list.lastUsed);
    setSavedTools(library.savedTools);
    return ordered;
  };
  const report = (error: unknown) =>
    setNotice(
      t("app.problem", { message: error instanceof Error ? error.message : String(error) }),
    );

  useEffect(() => {
    let current = true;
    Promise.all([ask("workspaces.list", {}), ask("library.list", {}), ask("trash.list", {})]).then(
      ([list, library, deleted]) => {
        if (!current) return;
        setTrash(deleted);
        const ordered = byUse(list.workspaces, list.lastUsed);
        setWorkspaces(ordered);
        setLastUsed(list.lastUsed);
        setSavedTools(library.savedTools);
        // Open the remembered workspace if it is still there, or else the most recently used one.
        const start = ordered.find((w) => w.id === remembered()) ?? ordered[0];
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

  // Opening a workspace is using it (APP-03), whether the person picked it or it opened by
  // itself, and whether or not its tool starts: the server records it, and the list shows it.
  const usedId = workspaces?.find((w) => w.id === openId)?.id;
  useEffect(() => {
    if (!usedId) return;
    let current = true;
    ask("workspaces.open", { id: usedId })
      .then(() => ask("workspaces.list", {}))
      .then(
        (list) => {
          if (!current) return;
          setLastUsed(list.lastUsed);
          setWorkspaces((shown) => inPlace(shown, list.workspaces));
        },
        (error: unknown) => {
          if (current) report(error);
        },
      );
    return () => {
      current = false;
    };
  }, [usedId]);

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
  if (workspaces.length === 0 && view !== "trash") {
    const inTrash = (trash?.entries.length ?? 0) > 0;
    return <EmptyState notice={notice} onTrash={inTrash ? () => setView("trash") : undefined} />;
  }
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
    <div className={view === "workspaces" ? "app" : "app one-section"}>
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
          <button
            type="button"
            aria-current={view === "trash" ? "page" : undefined}
            onClick={() => setView("trash")}
          >
            {t("nav.trash")}
          </button>
        </nav>
      </header>
      {view === "workspaces" ? (
        <>
          <aside>
            <Workspaces
              workspaces={workspaces}
              savedTools={savedTools}
              lastUsed={lastUsed}
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
          <main>
            {current && <ToolPanel key={`${current.id}:${reloads}`} workspace={current} />}
            {current?.currentVersion && (
              <History
                key={current.id}
                workspace={current}
                onChanged={async (done) => {
                  await refresh().catch(report);
                  setReloads((n) => n + 1);
                  setNotice(done);
                }}
              />
            )}
          </main>
        </>
      ) : view === "trash" ? (
        <main>
          {trash && (
            <Trash
              trash={trash}
              onRestore={async (entry) => {
                try {
                  if (entry.kind === "workspace") {
                    await ask("trash.restoreWorkspace", { id: entry.id });
                  } else {
                    await ask("trash.restoreSavedTool", { id: entry.id });
                  }
                  await refresh();
                  // A restored workspace opens when none is open, as after the last one went.
                  if (entry.kind === "workspace" && !current) open(entry.id);
                  setNotice(t("trash.restored", { name: entry.name }));
                } catch (error) {
                  report(error);
                }
              }}
              onEmpty={async (confirmation) => {
                try {
                  const { removed } = await ask("trash.empty", { confirmation });
                  setNotice(t("trash.emptied", { count: removed.length }));
                } catch (error) {
                  // Such as the trash having changed since it was shown: show it as it is now.
                  report(error);
                }
                await refresh().catch(report);
              }}
            />
          )}
        </main>
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
