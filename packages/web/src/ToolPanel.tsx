import type { Artifact, Workspace } from "@tessera/contracts";
import { createRuntime, type ToolRuntime } from "@tessera/runtime";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { HostIcon } from "./HostIcon.tsx";
import { t } from "./i18n/translate.ts";
import { SaveQuestion } from "./SaveQuestion.tsx";
import {
  rememberedState,
  rememberState,
  startTool,
  type SaveQuestion as Offer,
  type WriteQuestion as Question,
} from "./tool-start.ts";
import { WriteQuestion } from "./WriteQuestion.tsx";

// The tool panel (APP-01): the open workspace's tool, running in the sandbox through the runtime,
// with its data served by the server's bridge route (RUN-04). Exactly one tool runs: opening
// another workspace closes this one first (RUN-02). It is inline beside the chat, expanded over
// the chat's place, or full screen, and can be minimized; a minimized or stopped tool stays so
// after a reload (UX-07). Every control here is the host's, never the tool's.

type Mode = "starting" | "running" | "minimized" | "stopped";

type Props = {
  workspace: Workspace;
  /** Called after each change the tool saved to its data. */
  onDataChanged?: () => void;
  /** Called once the person allowed the tool's changes through a connection (A72). */
  onConnectionUsed?: () => void;
  /** Whether the tool takes the chat's place too; the app lays it out. */
  expanded?: boolean;
  /** Expands the tool, or puts it back beside the chat; none where there is no chat beside it. */
  onExpand?: (expanded: boolean) => void;
  headerActions?: ReactNode;
  navigation?: ReactNode;
  menuActions?: ReactNode;
  details?: ReactNode;
  saved?: boolean;
  /** Restarts only the runtime after a data restore; keeps the header's open panels. */
  reload?: number;
};

export function ToolPanel({
  workspace,
  onDataChanged,
  onConnectionUsed,
  expanded = false,
  onExpand,
  headerActions,
  navigation,
  menuActions,
  details,
  saved = false,
  reload = 0,
}: Props) {
  const menuId = useId();
  const detailsId = useId();
  const [detailsShown, setDetailsShown] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<ToolRuntime | null>(null);
  const starting = useRef<AbortController | null>(null);
  // The latest callbacks, for a tool started earlier to reach.
  const dataChanged = useRef(onDataChanged);
  const connectionUsed = useRef(onConnectionUsed);
  useEffect(() => {
    dataChanged.current = onDataChanged;
    connectionUsed.current = onConnectionUsed;
  });
  const name = workspace.title;
  const id = workspace.id;
  const hasTool = workspace.currentVersion !== null;
  const run = `${id}:${workspace.currentVersion}:${reload}`;
  // How the person left this tool, read once for this workspace.
  const [left] = useState(() => rememberedState(id));
  const [mode, setMode] = useState<Mode>(
    left?.mode === "minimized" ? "minimized" : left?.mode === "stopped" ? "stopped" : "starting",
  );
  const [fullScreen, setFullScreen] = useState(false);
  const [width, setWidth] = useState<Artifact["ui"]["width"]>("comfortable");
  // The question before a tool's first change through a connection, while it waits (A70).
  const [question, setQuestion] = useState<{ run: string; value: Question } | null>(null);
  const answering = useRef<((allowed: boolean) => void) | null>(null);
  const answer = (allowed: boolean) => {
    const resolve = answering.current;
    answering.current = null;
    setQuestion(null);
    resolve?.(allowed);
  };
  const askToWrite = (asked: Question) =>
    new Promise<boolean>((resolve) => {
      // A question still open is answered no: only the latest one is shown.
      answering.current?.(false);
      answering.current = resolve;
      setQuestion({ run, value: asked });
    });
  // The question before a file the tool offers is saved, while it waits (A81).
  const [offer, setOffer] = useState<{ run: string; value: Offer } | null>(null);
  const deciding = useRef<((save: boolean) => void) | null>(null);
  const decide = (save: boolean) => {
    const resolve = deciding.current;
    deciding.current = null;
    setOffer(null);
    resolve?.(save);
  };
  const askToSave = (asked: Offer) =>
    new Promise<boolean>((resolve) => {
      deciding.current?.(false);
      deciding.current = resolve;
      setOffer({ run, value: asked });
    });
  // A panel that goes, or a new tool, leaves no question open: it is answered no.
  useEffect(
    () => () => {
      answering.current?.(false);
      deciding.current?.(false);
      answering.current = null;
      deciding.current = null;
    },
    [run],
  );

  // Starts the tool through `open`, until the panel goes or another start replaces this one.
  const start = (current: ToolRuntime, open: Parameters<typeof startTool>[2]) => {
    starting.current?.abort();
    const controller = new AbortController();
    starting.current = controller;
    controller.signal.addEventListener(
      "abort",
      () => {
        answer(false);
        decide(false);
      },
      { once: true },
    );
    startTool(current, id, open, controller.signal, {
      onWrite: () => dataChanged.current?.(),
      onWidth: setWidth,
      askToWrite,
      askToSave,
      onConnectionUsed: () => connectionUsed.current?.(),
    }).then(
      (running) => {
        if (running) setMode("running");
      },
      () => {
        if (!controller.signal.aborted) setMode("stopped");
      },
    );
  };
  // The first start, from the effect that makes the runtime.
  const startFirst = useEffectEvent((current: ToolRuntime) => start(current, (r) => r.open(id)));

  useEffect(() => {
    const element = container.current;
    if (!element || !hasTool) return;
    // A minimized or stopped tool starts as it was left, and isn't opened (UX-07).
    const latest = rememberedState(id);
    const kept = latest?.mode === "minimized" || latest?.mode === "stopped" ? latest : undefined;
    const created = createRuntime(element, kept);
    runtime.current = created;
    const stop = created.onState((state) => {
      rememberState(id, state);
      if (state.mode === "stopped") setMode("stopped");
    });
    if (!kept) startFirst(created);
    return () => {
      starting.current?.abort();
      stop();
      created.close();
      runtime.current = null;
    };
    // A new workspace, or a new tool version, starts a new runtime.
  }, [id, hasTool, workspace.currentVersion, reload]);

  // One start at a time: the button goes while this one runs, and a second click does nothing,
  // so two restores never race for the same runtime.
  const restore = () => {
    if (!runtime.current || mode === "starting") return;
    setMode("starting");
    start(runtime.current, (r) => r.restore());
  };

  return (
    <section
      aria-label={t("tool.label", { name })}
      className={fullScreen ? "tool-panel full-screen" : "tool-panel"}
      // A stable hook for the scenario runner and tests (VER-03): titles repeat, IDs don't.
      data-workspace-id={id}
      data-mode={mode}
      data-width={expanded || fullScreen ? "wide" : width}
    >
      {question?.run === run && <WriteQuestion question={question.value} onAnswer={answer} />}
      {offer?.run === run && <SaveQuestion question={offer.value} onAnswer={decide} />}
      <header className="tool-header">
        {navigation}
        <div className="tool-heading">
          <h1 title={name}>{name}</h1>
          <p>
            {t("tool.kept")}
            {saved && <span className="saved-label">{t("tool.inLibrary")}</span>}
          </p>
        </div>
        <div className="tool-header-actions">
          {headerActions}
          {hasTool && (mode === "minimized" || mode === "stopped") && (
            <button
              type="button"
              className="icon-button"
              aria-label={t("tool.restore")}
              title={t("tool.restore")}
              onClick={restore}
            >
              <HostIcon name="expand" />
            </button>
          )}
          {hasTool && (
            <button
              type="button"
              className="icon-button full-screen-opener"
              aria-label={fullScreen ? t("tool.leaveFullScreen") : t("tool.fullScreen")}
              title={fullScreen ? t("tool.leaveFullScreen") : t("tool.fullScreen")}
              aria-pressed={fullScreen}
              onClick={() => setFullScreen(!fullScreen)}
            >
              <HostIcon name="expand" />
            </button>
          )}
          <button
            type="button"
            className="icon-button tool-more"
            popoverTarget={menuId}
            aria-label={t("tool.more")}
            title={t("tool.more")}
          >
            <HostIcon name="more" />
          </button>
        </div>
      </header>
      <div id={menuId} popover="auto" className="tool-menu">
        {menuActions}
        {details && (
          <button type="button" popoverTarget={detailsId}>
            {t("details.heading")}
          </button>
        )}
        {hasTool && mode === "running" && (
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              runtime.current?.minimize();
              setMode("minimized");
            }}
          >
            {t("tool.minimize")}
          </button>
        )}
        {hasTool && onExpand && !fullScreen && (
          <button
            type="button"
            aria-pressed={expanded}
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              onExpand(!expanded);
            }}
          >
            {expanded ? t("tool.leaveExpanded") : t("tool.expand")}
          </button>
        )}
        {hasTool && (
          <button
            type="button"
            className="menu-full-screen"
            onClick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              setFullScreen(!fullScreen);
            }}
          >
            {fullScreen ? t("tool.leaveFullScreen") : t("tool.fullScreen")}
          </button>
        )}
      </div>
      {details && (
        <div
          id={detailsId}
          popover="auto"
          className="host-panel"
          onToggle={(event) => setDetailsShown(event.newState === "open")}
        >
          <button type="button" popoverTarget={detailsId} popoverTargetAction="hide">
            {t("tool.closePanel")}
          </button>
          {detailsShown && details}
        </div>
      )}
      <p role="status" className="tool-status">
        {!hasTool && t("tool.noTool", { name })}
        {hasTool && mode === "minimized" && t("tool.minimized", { name })}
        {hasTool && mode === "stopped" && t("tool.stopped", { name })}
      </p>
      <div
        ref={container}
        className="tool-frame"
        hidden={!hasTool || (mode !== "running" && mode !== "starting")}
      />
    </section>
  );
}
