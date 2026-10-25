import type { RuntimeState, ToolRuntime } from "@tessera/runtime";
import { serveBridge, serverData } from "@tessera/runtime";
import { ask } from "./host-api.ts";

// Starting the open workspace's tool, and remembering how the person left it (RUN-02, UX-07).

export type StartDeps = {
  ask: typeof ask;
  serveBridge: typeof serveBridge;
  serverData: typeof serverData;
};
const defaults: StartDeps = { ask, serveBridge, serverData };

/**
 * Starts the tool through `open` (a first start or a restore) and serves it the bridge with what
 * its version declares. Nothing more happens once `signal` is aborted, at whichever step it is:
 * a panel closed while the server answered never opens a tool it can no longer close (RUN-02).
 * Resolves true if the tool now runs.
 */
export async function startTool(
  runtime: ToolRuntime,
  workspaceId: string,
  open: (runtime: ToolRuntime) => ReturnType<ToolRuntime["open"]>,
  signal: AbortSignal,
  deps: StartDeps = defaults,
): Promise<boolean> {
  const { capabilities } = await deps.ask("workspaces.open", { id: workspaceId });
  if (signal.aborted) return false;
  const tool = await open(runtime);
  if (signal.aborted) return false;
  deps.serveBridge(tool, { capabilities, data: deps.serverData(workspaceId) });
  return true;
}

// How each workspace's tool was left, for this tab: minimized and stopped tools stay so after a
// reload or a switch away and back (UX-07). Storage can be off; then nothing is remembered.
const key = (workspaceId: string) => `tessera.tool.${workspaceId}`;

export function rememberedState(workspaceId: string): RuntimeState | undefined {
  try {
    const raw = sessionStorage.getItem(key(workspaceId));
    const state = raw ? (JSON.parse(raw) as RuntimeState) : undefined;
    return state && state.mode !== "empty" && "mountId" in state && state.mountId === workspaceId
      ? state
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberState(workspaceId: string, state: RuntimeState): void {
  try {
    sessionStorage.setItem(key(workspaceId), JSON.stringify(state));
  } catch {
    // Nothing to do: the tool just won't be remembered.
  }
}
