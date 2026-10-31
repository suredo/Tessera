import type { SavedTool, SetupReport, Trash as TrashList, Workspace } from "@tessera/contracts";
import { useEffect, useRef, useState } from "react";
import { exportArchive, importArchive, saveFile } from "./archives.ts";
import { ask, HostError } from "./host-api.ts";
import { t } from "./i18n/translate.ts";
import { History } from "./History.tsx";
import { ImportFile } from "./ImportFile.tsx";
import { Library } from "./Library.tsx";
import { checkSetup, runProbe } from "./setup.ts";
import { SetupNotice, Status } from "./Status.tsx";
import {
  carryOut,
  askToConfirmData,
  dataOutcome,
  withInterfaceOutcome,
  type RequestOutcome,
} from "./generate.ts";
import { DataChangeOffer } from "./DataChangeOffer.tsx";
import { RequestControl } from "./request-control.ts";
import { RequestBox } from "./RequestBox.tsx";
import { ToolPanel } from "./ToolPanel.tsx";
import { Trash } from "./Trash.tsx";
import { Workspaces } from "./Workspaces.tsx";

// The host's main screen (APP-01, APP-02, APP-03): the workspaces beside the open workspace's
// tool. With no workspaces it invites the person to describe what they need, with no example
// tools (A12). The chat that makes tools comes with M2.

/** The first-run screen, shown while there are no workspaces (APP-02). */
type EmptyProps = {
  notice?: string;
  onTrash?: () => void;
  /** Imports a file, such as work brought from another computer (APP-06). */
  onImport?: (file: File) => Promise<void>;
  /** The setup check, and opening the status screen (PLAT-03, APP-07). */
  setup?: SetupReport | null;
  /** Why the check couldn't be made, or "". */
  setupProblem?: string;
  onStatus?: () => void;
  /** Carries out a request; offered only once the setup check passes (PLAT-03). */
  onRequest?: (request: string) => Promise<void>;
  /** True while a request runs. */
  requesting?: boolean;
  cancelControl?: React.ReactNode;
};

export function EmptyState({
  notice = "",
  onTrash,
  onImport,
  setup = null,
  setupProblem = "",
  onStatus,
  onRequest,
  requesting = false,
  cancelControl,
}: EmptyProps) {
  return (
    <main className="empty">
      <h1>{t("home.heading")}</h1>
      <p>{t("home.intro")}</p>
      {onRequest && setup?.ready && <RequestBox working={requesting} onRequest={onRequest} />}
      {/* Such as the trash notice after the last workspace is deleted. */}
      <p role="status">{notice}</p>
      {cancelControl}
      {/* What was deleted can still come back from here (DATA-09). */}
      {onTrash && (
        <button type="button" onClick={onTrash}>
          {t("home.trash")}
        </button>
      )}
      {onImport && <ImportFile onImport={onImport} />}
      {onStatus &&
        ((setup && !setup.ready) || (!setup && setupProblem) ? (
          <SetupNotice report={setup} problem={setupProblem} onOpen={onStatus} />
        ) : (
          <button type="button" onClick={onStatus}>
            {t("setup.openStatus")}
          </button>
        ))}
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
  const [view, setView] = useState<"workspaces" | "library" | "trash" | "status">("workspaces");
  // The setup check (PLAT-03): until it passes, nothing that needs the model is offered.
  const [setup, setSetup] = useState<SetupReport | null>(null);
  // A request running, and a saved tool a request matched, waiting for the person's choice.
  const [requesting, setRequesting] = useState(false);
  const control = useRef<RequestControl | null>(null);
  const [stopping, setStopping] = useState(false);
  const [cancelProblem, setCancelProblem] = useState("");
  const [dataOffer, setDataOffer] = useState<RequestOutcome["dataOffer"]>();
  const cancelRequest = async () => {
    const owner = control.current;
    if (!owner || stopping) return;
    setStopping(true);
    setCancelProblem("");
    // A waiting review has no active carryOut to settle it; discard its local proposal now.
    if (!requesting) {
      setDataOffer(undefined);
      setNotice(
        withInterfaceOutcome(dataOffer?.interfaceMessage, { message: t("request.stopped") })
          .message,
      );
    }
    try {
      const confirmed = await owner.cancel();
      if (control.current === owner && !confirmed && requesting)
        setCancelProblem(t("request.cancelUnknown"));
    } catch {
      if (control.current === owner) setCancelProblem(t("request.cancelUnknown"));
    }
  };
  const cancelControl = (requesting || dataOffer) && (
    <div className="request-control">
      <button type="button" disabled={stopping} onClick={() => void cancelRequest()}>
        {t("request.cancel")}
      </button>
      <p role="status">{cancelProblem || (stopping ? t("request.stopping") : "")}</p>
    </div>
  );
  const [offer, setOffer] = useState<{ id: string; name: string } | null>(null);

  // Why the last check couldn't be made, such as the server not answering; "" when it was.
  const [setupProblem, setSetupProblem] = useState("");
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const [trash, setTrash] = useState<TrashList | null>(null);
  // Moved on after a restore or an undo, so the tool starts again with the changed data.
  const [reloads, setReloads] = useState(0);
  // Moved on by each change the running tool saves, so the history shows it at once (APP-05).
  const [toolChanges, setToolChanges] = useState(0);

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

  // The setup check on start (PLAT-03); the status screen runs it again on request.
  useEffect(() => {
    let current = true;
    checkSetup().then(
      (report) => current && setSetup(report),
      (error: unknown) => current && setSetupProblem(message(error)),
    );
    return () => {
      current = false;
    };
  }, []);

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

  // A refusal is the server's plain words; anything else says something went wrong.
  const say = (error: unknown) =>
    error instanceof HostError ? setNotice(error.message) : report(error);
  const exportFile = async (
    request: { exported: "workspace" | "savedTool"; id: string },
    name: string,
  ) => {
    try {
      const { name: file, file: bytes } = await exportArchive(request);
      saveFile(file, bytes);
      setNotice(t("archive.exported", { name, file }));
    } catch (error) {
      say(error);
    }
  };
  const importFile = async (file: File) => {
    try {
      const reply = await importArchive(file);
      if (!reply.ok) return setNotice(reply.message);
      await refresh();
      const workspace = reply.workspaces.map((w) => w.title).join(", ");
      const tools = reply.savedTools.map((s) => s.name).join(", ");
      const said = tools
        ? t("archive.importedWithTools", { workspace, tools })
        : t("archive.imported", { workspace });
      setNotice(reply.asCopy ? `${said} ${t("archive.asCopy")}` : said);
      // What came in opens, so the person sees it.
      open(reply.workspaces[0]!.id);
      setView("workspaces");
    } catch (error) {
      say(error);
    }
  };

  // A request from the chat (GEN-01): one at a time, whatever screen is shown; then the lists are
  // read again and what was made opens. A saved tool the request matched is offered, to continue
  // or to use again, and nothing opens until the person chooses (GEN-18).
  const request = async (text: string) => {
    if (requesting) return;
    const owner = new RequestControl();
    control.current = owner;
    setStopping(false);
    setCancelProblem("");
    setRequesting(true);
    setOffer(null);
    setDataOffer(undefined);
    try {
      const outcome = await carryOut(
        text,
        openId,
        undefined,
        async (id) => {
          await refresh();
          open(id);
          setView("workspaces");
        },
        owner,
      );
      setDataOffer(owner.stopped ? undefined : outcome.dataOffer);
      const { savedTools: saved } = await owner
        .wait(refresh().then(() => ask("library.list", {})))
        .catch(() => ({ savedTools: [] }));
      if (outcome.savedToolId) {
        const tool = saved.find((s) => s.id === outcome.savedToolId);
        if (tool) {
          setOffer({ id: tool.id, name: tool.name });
          setNotice(t("request.offerSaved", { name: tool.name }));
          return;
        }
      }
      if (outcome.openWorkspaceId) {
        open(outcome.openWorkspaceId);
        setView("workspaces");
      }
      if (outcome.dataChanged || outcome.reloadData) {
        setReloads((n) => n + 1);
        setToolChanges((n) => n + 1);
      }
      setNotice(outcome.message || t("request.failedPlain"));
    } catch (error) {
      say(error);
    } finally {
      setRequesting(false);
    }
  };
  const takeOffer = async (choice: "continue" | "useAgain") => {
    if (!offer) return;
    try {
      const workspaceId =
        choice === "continue"
          ? (await ask("library.continue", { id: offer.id })).workspace.id
          : await ask("library.useAgain", { id: offer.id }).then((result) => {
              if (!result.ok) throw new HostError(result.message);
              return result.workspace.id;
            });
      setOffer(null);
      await refresh();
      showWorkspace(workspaceId);
      setNotice(
        t(choice === "continue" ? "request.continued" : "library.usedAgain", { name: offer.name }),
      );
    } catch (error) {
      say(error);
    }
  };
  const takeDataOffer = async (approve: boolean) => {
    if (!dataOffer || requesting) return;
    const owner = control.current;
    if (owner?.stopped) return;
    setRequesting(true);
    setStopping(false);
    setCancelProblem("");
    const token = dataOffer.token;
    const interfaceMessage = dataOffer.interfaceMessage;
    setDataOffer(undefined);
    try {
      const pending = askToConfirmData({ token, approve });
      const reply = await (owner ? owner.wait(pending) : pending);
      const outcome = withInterfaceOutcome(
        interfaceMessage,
        dataOutcome(reply),
        reply.kind === "failed" ? reply.message : undefined,
      );
      await (owner ? owner.wait(refresh()) : refresh()).catch(report);
      if (outcome.openWorkspaceId) {
        open(outcome.openWorkspaceId);
        setView("workspaces");
      }
      if (outcome.dataChanged) {
        setReloads((n) => n + 1);
        setToolChanges((n) => n + 1);
      }
      setNotice(outcome.message);
    } catch {
      await (owner ? owner.wait(refresh()) : refresh()).catch(report);
      setReloads((n) => n + 1);
      setToolChanges((n) => n + 1);
      setNotice(
        interfaceMessage
          ? t("request.mixedUnknown", { interfaceMessage })
          : t("request.dataUnknown"),
      );
    } finally {
      setRequesting(false);
    }
  };

  if (workspaces === null) {
    return (
      <main>
        <p role="status">{notice || t("app.loading")}</p>
      </main>
    );
  }
  if (workspaces.length === 0 && view !== "trash" && view !== "status") {
    const inTrash = (trash?.entries.length ?? 0) > 0;
    return (
      <EmptyState
        notice={notice}
        onTrash={inTrash ? () => setView("trash") : undefined}
        onImport={importFile}
        setup={setup}
        setupProblem={setupProblem}
        onStatus={() => setView("status")}
        onRequest={request}
        requesting={requesting}
        cancelControl={cancelControl}
      />
    );
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
          <button
            type="button"
            aria-current={view === "status" ? "page" : undefined}
            onClick={() => setView("status")}
          >
            {t("nav.status")}
          </button>
        </nav>
        {view !== "status" && (
          <SetupNotice report={setup} problem={setupProblem} onOpen={() => setView("status")} />
        )}
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
              onExport={(id) =>
                exportFile(
                  { exported: "workspace", id },
                  workspaces.find((w) => w.id === id)?.title ?? "",
                )
              }
            />
            <ImportFile onImport={importFile} />
          </aside>
          <main>
            {setup?.ready && <RequestBox working={requesting} onRequest={request} />}
            {current && (
              <ToolPanel
                key={`${current.id}:${reloads}`}
                workspace={current}
                onDataChanged={() => setToolChanges((n) => n + 1)}
              />
            )}
            {current?.currentVersion && (
              <History
                key={current.id}
                workspace={current}
                changes={toolChanges}
                onChanged={async (done) => {
                  await refresh().catch(report);
                  setReloads((n) => n + 1);
                  setNotice(done);
                }}
              />
            )}
          </main>
        </>
      ) : view === "status" ? (
        <main>
          <Status
            report={setup}
            problem={setupProblem}
            onRecheck={async () => {
              try {
                setSetup(await checkSetup());
                setSetupProblem("");
              } catch (error) {
                setSetupProblem(message(error));
              }
            }}
            onProbe={() => runProbe()}
          />
        </main>
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
                  // Such as the trash having changed since it was shown: the server says so in
                  // plain words, and the trash shows what it holds now.
                  if (error instanceof HostError) setNotice(error.message);
                  else report(error);
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
            onExport={(tool) => exportFile({ exported: "savedTool", id: tool.id }, tool.name)}
          />
        </main>
      )}
      <div className="notice">
        {/* The outcome notice stays the first status; Cancel's own status follows it. */}
        <p role="status">{notice}</p>
        {cancelControl}
        {dataOffer && (
          <DataChangeOffer offer={dataOffer} working={requesting} onChoose={takeDataOffer} />
        )}
        {/* A saved tool the request matched: the person chooses (GEN-18). */}
        {offer && (
          <p className="offer">
            <button type="button" onClick={() => void takeOffer("continue")}>
              {t("request.continue", { name: offer.name })}
            </button>{" "}
            <button type="button" onClick={() => void takeOffer("useAgain")}>
              {t("request.useAgain", { name: offer.name })}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
