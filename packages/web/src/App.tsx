import type { SavedTool, SetupReport, Trash as TrashList, Workspace } from "@tessera/contracts";
import { useEffect, useRef, useState } from "react";
import { exportArchive, importArchive, saveFile } from "./archives.ts";
import { Chat } from "./Chat.tsx";
import { useChat, type ShownMessage } from "./chat.ts";
import { ask, HostError, problemText } from "./host-api.ts";
import { t } from "./i18n/translate.ts";
import { History } from "./History.tsx";
import { ImportFile } from "./ImportFile.tsx";
import { Library } from "./Library.tsx";
import { checkSetup, runProbe } from "./setup.ts";
import { SetupNotice, Status } from "./Status.tsx";
import {
  carryOut,
  confirmDataChoice,
  withInterfaceOutcome,
  type RequestOutcome,
} from "./generate.ts";
import { DataChangeOffer } from "./DataChangeOffer.tsx";
import { Details } from "./Details.tsx";
import { RequestControl } from "./request-control.ts";
import { RequestBox } from "./RequestBox.tsx";
import { Split } from "./Split.tsx";
import { useRequestProgress, type Progress } from "./progress.ts";
import { ToolPanel } from "./ToolPanel.tsx";
import { Trash } from "./Trash.tsx";
import { Workspaces } from "./Workspaces.tsx";

// The host's main screen (APP-01, APP-02, APP-03): the workspaces beside the open workspace's
// chat and tool. With no workspaces it invites the person to describe what they need, with no
// example tools (A12). A request's reply is said in the chat, kept with its workspace (ADR 0011);
// the notice says what the person's other actions did.

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
  /** The running request's stage and elapsed time (GEN-16). */
  progress?: Progress;
  cancelControl?: React.ReactNode;
  /** The details view, for requests that made no tool (APP-09, GEN-10). */
  details?: React.ReactNode;
  /** What was asked and answered here, with no workspace to keep it in (APP-01). */
  chat?: readonly ShownMessage[];
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
  progress,
  cancelControl,
  details,
  chat = [],
}: EmptyProps) {
  return (
    <main className="empty">
      <h1>{t("home.heading")}</h1>
      <p>{t("home.intro")}</p>
      {((onRequest && setup?.ready) || chat.length > 0) && (
        <Chat messages={chat}>
          {onRequest && setup?.ready && (
            <RequestBox working={requesting} progress={progress} onRequest={onRequest} />
          )}
        </Chat>
      )}
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
      {details}
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
  // The open workspace's chat, and what was said with none open (APP-01, APP-03).
  const chat = useChat(openId);
  const [view, showView] = useState<"workspaces" | "library" | "trash" | "status">("workspaces");
  // The tool taking the chat's place too (APP-01); only an open tool can, and only beside a chat.
  const [expanded, setExpanded] = useState(false);
  // The setup check (PLAT-03): until it passes, nothing that needs the model is offered.
  const [setup, setSetup] = useState<SetupReport | null>(null);
  // A request running, and a saved tool a request matched, waiting for the person's choice.
  const [requesting, setRequesting] = useState(false);
  const control = useRef<RequestControl | null>(null);
  const [stopping, setStopping] = useState(false);
  // A stopped request's outcome is shown while the lists still refresh; Cancel has nothing left to do.
  const [settled, setSettled] = useState(false);
  const [cancelProblem, setCancelProblem] = useState("");
  const [dataOffer, setDataOffer] = useState<RequestOutcome["dataOffer"]>();
  // Stage and elapsed time while the request runs, until a cancel has settled it (GEN-16).
  const progress = useRequestProgress(control, requesting && !settled);
  // Whose chat is on screen: the open workspace's on the workspaces, the first-run screen's (null)
  // in their place, and none (undefined) on the other screens or behind an expanded tool.
  // A host control, so it needs no model: an open tool beside its chat can expand, setup or not.
  const toolExpanded = expanded && !!workspaces?.find((w) => w.id === openId)?.currentVersion;
  // An expanded tool takes the chat's place, so its chat is not on screen then.
  const chatShown: string | null | undefined =
    workspaces?.length === 0
      ? view === "trash" || view === "status"
        ? undefined
        : null
      : view === "workspaces" && !toolExpanded
        ? openId
        : undefined;
  // A reply is said in its workspace's chat, and in the notice too, so it reaches the person
  // wherever they are. The notice leaves it out while that chat is on screen, and drops it when
  // the person moves on from that chat, so it is never on the page twice (APP-01, GEN-08).
  const [replyNotice, setReplyNotice] = useState<{ text: string; target: string | null } | null>(
    null,
  );
  const replyInView =
    replyNotice !== null && chatShown !== undefined && replyNotice.target === chatShown;
  const shownNotice = replyInView && notice === replyNotice.text ? "" : notice;
  // Moving on from the chat that showed the reply: it has been read there, so the notice drops it.
  const movingOn = () => {
    if (!replyInView || !replyNotice) return;
    setNotice((shown) => (shown === replyNotice.text ? "" : shown));
    setReplyNotice(null);
  };
  const setView = (next: typeof view) => {
    movingOn();
    showView(next);
  };
  const tellReply = (text: string, target: string | null) => {
    setNotice(text);
    setReplyNotice({ text, target });
  };
  const cancelRequest = async () => {
    const owner = control.current;
    if (!owner || stopping) return;
    setStopping(true);
    setCancelProblem("");
    // A waiting review has no active carryOut to settle it; discard its local proposal now.
    if (!requesting) {
      setDataOffer(undefined);
      const said = withInterfaceOutcome(dataOffer?.interfaceMessage, {
        message: t("request.stopped"),
      }).message;
      // The review's own workspace, wherever the person is now (APP-03).
      const reviewed = dataOffer?.workspaceId ?? openId;
      void chat.said(reviewed, said);
      tellReply(said, reviewed);
    }
    try {
      const confirmed = await owner.cancel();
      if (control.current === owner && !confirmed && requesting)
        setCancelProblem(t("request.cancelUnknown"));
    } catch {
      if (control.current === owner) setCancelProblem(t("request.cancelUnknown"));
    }
  };
  const cancelControl = ((requesting && !settled) || dataOffer) && (
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
  const message = problemText;
  const [trash, setTrash] = useState<TrashList | null>(null);
  // Moved on after a restore or an undo, so the tool starts again with the changed data.
  const [reloads, setReloads] = useState(0);
  // Moved on by each change the running tool saves, so the history shows it at once (APP-05).
  const [toolChanges, setToolChanges] = useState(0);
  // Moved on by every request that settles, whatever it changed, so open details load again.
  const [settledRequests, setSettledRequests] = useState(0);

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
  const report = (error: unknown) => setNotice(t("app.problem", { message: problemText(error) }));
  // Why the first load of the lists failed, "" while none has; trying again moves `opening` on.
  const [openProblem, setOpenProblem] = useState("");
  const [opening, setOpening] = useState(0);

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
      // Not a dead end: the person is told plainly and can try again (#217).
      (error: unknown) => {
        if (current) setOpenProblem(problemText(error));
      },
    );
    return () => {
      current = false;
    };
  }, [opening]);

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
    movingOn();
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
    // The request shows in the chat at once; its reply goes with it, once, into the workspace the
    // request made or opened, such as a new tool's staged before its checks end, or else the one
    // open when it was sent (APP-03).
    const askedIn = openId;
    let madeIn: string | null = null;
    const asked = chat.asking(askedIn, text);
    let replied = false;
    const reply = (message: string, target: string | null = madeIn ?? askedIn) => {
      if (replied) return;
      replied = true;
      void chat.answered(asked, target, message);
      tellReply(message, target);
    };
    const owner = new RequestControl();
    control.current = owner;
    setStopping(false);
    setSettled(false);
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
          madeIn = id;
          await refresh();
          open(id);
          setView("workspaces");
        },
        owner,
      );
      setDataOffer(owner.stopped ? undefined : outcome.dataOffer);
      // After Cancel the outcome is already known: say it now, not after the bounded refresh.
      if (owner.stopped && !outcome.savedToolId) {
        reply(
          outcome.message || t("request.failedPlain"),
          outcome.openWorkspaceId ?? madeIn ?? askedIn,
        );
        setSettled(true);
      }
      const { savedTools: saved } = await owner
        .wait(refresh().then(() => ask("library.list", {})))
        .catch(() => ({ savedTools: [] }));
      if (outcome.savedToolId) {
        const tool = saved.find((s) => s.id === outcome.savedToolId);
        if (tool) {
          setOffer({ id: tool.id, name: tool.name });
          reply(t("request.offerSaved", { name: tool.name }));
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
      reply(
        outcome.message || t("request.failedPlain"),
        outcome.openWorkspaceId ?? madeIn ?? askedIn,
      );
    } catch (error) {
      reply(
        error instanceof HostError
          ? error.message
          : t("app.problem", { message: problemText(error) }),
      );
    } finally {
      setRequesting(false);
      setSettledRequests((n) => n + 1);
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
    const { token, interfaceMessage, workspaceId: reviewed } = dataOffer;
    setDataOffer(undefined);
    try {
      const outcome = await confirmDataChoice(token, approve, interfaceMessage, owner ?? undefined);
      await (owner ? owner.wait(refresh()) : refresh()).catch(report);
      if (outcome.openWorkspaceId) {
        open(outcome.openWorkspaceId);
        setView("workspaces");
      }
      if (outcome.dataChanged || outcome.reloadData) {
        setReloads((n) => n + 1);
        setToolChanges((n) => n + 1);
      }
      // The reviewed workspace's chat, though the person may have opened another meanwhile.
      void chat.said(outcome.openWorkspaceId ?? reviewed, outcome.message);
      tellReply(outcome.message, outcome.openWorkspaceId ?? reviewed);
    } finally {
      setRequesting(false);
      setSettledRequests((n) => n + 1);
    }
  };

  if (workspaces === null) {
    if (openProblem) {
      return (
        <main>
          <p role="alert">{t("app.openFailed", { message: openProblem })}</p>
          <button
            type="button"
            onClick={() => {
              setOpenProblem("");
              setOpening((n) => n + 1);
            }}
          >
            {t("app.retry")}
          </button>
        </main>
      );
    }
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
        notice={shownNotice}
        onTrash={inTrash ? () => setView("trash") : undefined}
        onImport={importFile}
        setup={setup}
        setupProblem={setupProblem}
        onStatus={() => setView("status")}
        onRequest={request}
        requesting={requesting}
        progress={progress}
        cancelControl={cancelControl}
        details={<Details workspace={null} changes={settledRequests} />}
        chat={chat.messages(null)}
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
            {(() => {
              // The chat beside the tool, with the divider between them, where both are shown. The
              // kept conversation shows whatever the setup; asking needs it (PLAT-03).
              const chatPane = (setup?.ready || chat.messages(openId).length > 0) && (
                <Chat messages={chat.messages(openId)}>
                  {setup?.ready && (
                    <RequestBox working={requesting} progress={progress} onRequest={request} />
                  )}
                </Chat>
              );
              const toolPane = current && (
                <ToolPanel
                  key={`${current.id}:${reloads}`}
                  workspace={current}
                  onDataChanged={() => setToolChanges((n) => n + 1)}
                  expanded={toolExpanded}
                  onExpand={chatPane ? setExpanded : undefined}
                />
              );
              return chatPane && toolPane ? (
                <Split first={chatPane} second={toolPane} expanded={toolExpanded} />
              ) : (
                <>
                  {chatPane}
                  {toolPane}
                </>
              );
            })()}
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
            {current && (
              <Details
                key={`details-${current.id}`}
                workspace={current}
                changes={toolChanges + settledRequests}
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
                // Its own message, so an earlier one (such as Use again's) never stays on
                // screen and says something untrue about this workspace (GEN-08).
                setNotice(t("request.continued", { name: tool.name }));
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
            onDescribe={(tool, description) =>
              act(() => ask("library.describe", { id: tool.id, description }))
            }
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
        <p role="status">{shownNotice}</p>
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
