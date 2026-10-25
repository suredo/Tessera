import type { Workspace } from "@tessera/contracts";
import { createRuntime, serveBridge, serverData, type ToolRuntime } from "@tessera/runtime";
import { useEffect, useRef, useState } from "react";
import { ask } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

// The tool panel (APP-01): the open workspace's tool, running in the sandbox through the runtime,
// with its data served by the server's bridge route (RUN-04). Exactly one tool runs: opening
// another workspace closes this one first (RUN-02). It can be minimized and shown full screen.

type Mode = "starting" | "running" | "minimized" | "stopped";

// Starts the tool, through `open` (a first start or a restore), and serves it the bridge with what
// its version declares.
async function startTool(
  runtime: ToolRuntime,
  workspaceId: string,
  open: (runtime: ToolRuntime) => ReturnType<ToolRuntime["open"]>,
) {
  const { capabilities } = await ask("workspaces.open", { id: workspaceId });
  const tool = await open(runtime);
  serveBridge(tool, { capabilities, data: serverData(workspaceId) });
}

export function ToolPanel({ workspace }: { workspace: Workspace }) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<ToolRuntime | null>(null);
  const [mode, setMode] = useState<Mode>("starting");
  const [fullScreen, setFullScreen] = useState(false);
  const name = workspace.title;
  const id = workspace.id;
  const hasTool = workspace.currentVersion !== null;

  useEffect(() => {
    const element = container.current;
    if (!element || !hasTool) return;
    const created = createRuntime(element);
    runtime.current = created;
    const stop = created.onState((state) => {
      if (state.mode === "stopped") setMode("stopped");
    });
    startTool(created, id, (r) => r.open(id)).then(
      () => setMode("running"),
      () => setMode("stopped"),
    );
    return () => {
      stop();
      created.close();
      runtime.current = null;
    };
    // A new workspace, or a new tool version, starts a new runtime.
  }, [id, hasTool, workspace.currentVersion]);

  const restore = () => {
    const current = runtime.current;
    if (!current) return;
    startTool(current, id, (r) => r.restore()).then(
      () => setMode("running"),
      () => setMode("stopped"),
    );
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
