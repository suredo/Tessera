import type { Workspace } from "@tessera/contracts";
import { createRuntime, type ToolRuntime } from "@tessera/runtime";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { t } from "./i18n/translate.ts";
import { rememberedState, rememberState, startTool } from "./tool-start.ts";

// The tool panel (APP-01): the open workspace's tool, running in the sandbox through the runtime,
// with its data served by the server's bridge route (RUN-04). Exactly one tool runs: opening
// another workspace closes this one first (RUN-02). It can be minimized and shown full screen,
// and a minimized or stopped tool stays so after a reload (UX-07).

type Mode = "starting" | "running" | "minimized" | "stopped";

type Props = {
  workspace: Workspace;
  /** Called after each change the tool saved to its data. */
  onDataChanged?: () => void;
};

export function ToolPanel({ workspace, onDataChanged }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<ToolRuntime | null>(null);
  const starting = useRef<AbortController | null>(null);
  // The latest callback, for a tool started earlier to reach.
  const dataChanged = useRef(onDataChanged);
  useEffect(() => {
    dataChanged.current = onDataChanged;
  });
  const name = workspace.title;
  const id = workspace.id;
  const hasTool = workspace.currentVersion !== null;
  // How the person left this tool, read once for this workspace.
  const [left] = useState(() => rememberedState(id));
  const [mode, setMode] = useState<Mode>(
    left?.mode === "minimized" ? "minimized" : left?.mode === "stopped" ? "stopped" : "starting",
  );
  const [fullScreen, setFullScreen] = useState(false);

  // Starts the tool through `open`, until the panel goes or another start replaces this one.
  const start = (current: ToolRuntime, open: Parameters<typeof startTool>[2]) => {
    starting.current?.abort();
    const controller = new AbortController();
    starting.current = controller;
    startTool(current, id, open, controller.signal, {
      onWrite: () => dataChanged.current?.(),
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
    const kept = left?.mode === "minimized" || left?.mode === "stopped" ? left : undefined;
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
  }, [id, hasTool, left, workspace.currentVersion]);

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
    >
      <div className="tool-controls">
        {hasTool && mode === "running" && (
          <button
            type="button"
            onClick={() => {
              runtime.current?.minimize();
              setMode("minimized");
            }}
          >
            {t("tool.minimize")}
          </button>
        )}
        {hasTool && (mode === "minimized" || mode === "stopped") && (
          <button type="button" onClick={restore}>
            {t("tool.restore")}
          </button>
        )}
        {hasTool && (
          <button
            type="button"
            aria-pressed={fullScreen}
            onClick={() => setFullScreen(!fullScreen)}
          >
            {fullScreen ? t("tool.leaveFullScreen") : t("tool.fullScreen")}
          </button>
        )}
      </div>
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
