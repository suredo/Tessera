import type { SavedTool, Workspace } from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask } from "./host-api.ts";
import { t } from "./i18n/translate.ts";
import { ToolPanel } from "./ToolPanel.tsx";
import { Workspaces } from "./Workspaces.tsx";

// The host's main screen (APP-01, APP-02, APP-03): the workspaces beside the open workspace's
// tool. With no workspaces it invites the person to describe what they need, with no example
// tools (A12). The chat that makes tools comes with M2.

/** The first-run screen, shown while there are no workspaces (APP-02). */
export function EmptyState({ notice = "" }: { notice?: string }) {
  return (
    <main className="empty">
      <h1>{t("home.heading")}</h1>
      <p>{t("home.intro")}</p>
      <p role="status">{t("home.status")}</p>
      {/* Such as the trash notice after the last workspace is deleted. */}
      <p role="status">{notice}</p>
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

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [savedTools, setSavedTools] = useState<SavedTool[]>([]);
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(remembered);
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [list, library] = await Promise.all([
      ask("workspaces.list", {}),
      ask("library.list", {}),
    ]);
    const ordered = byUse(list.workspaces, list.lastUsed);
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
    Promise.all([ask("workspaces.list", {}), ask("library.list", {})]).then(
      ([list, library]) => {
        if (!current) return;
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
  if (workspaces.length === 0) return <EmptyState notice={notice} />;
  const current = workspaces.find((w) => w.id === openId) ?? null;

  return (
    <div className="app">
      <header>
        <h1>{t("app.title")}</h1>
      </header>
      <nav>
        <Workspaces
          workspaces={workspaces}
          savedTools={savedTools}
          lastUsed={lastUsed}
          openId={openId}
          onOpen={open}
          onRename={async (id, title) => {
            await ask("workspaces.rename", { id, title }).catch(report);
            await refresh().catch(report);
          }}
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
      </nav>
      <main>{current && <ToolPanel key={current.id} workspace={current} />}</main>
      <p role="status" className="notice">
        {notice}
      </p>
    </div>
  );
}
