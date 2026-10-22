import { mountTool, type MountedTool, type WatchdogOptions } from "./host.ts";

// One active runtime (RUN-02): the host app keeps exactly one tool running. Opening another tool
// disposes the current one first, and minimizing disposes it too, its frames, channel and timers
// with it, while remembering which tool to bring back. The state is reported on every change, so
// the host app can keep it and start from it after a reload (UX-07). A tool the watchdog stopped,
// or that kept leaving its page, is stopped: not running, and not started again on its own.

/**
 * What the runtime shows: nothing, the running tool, a minimized tool that isn't running, or a
 * tool that was stopped because it stopped answering or kept leaving its page.
 */
export type RuntimeState =
  | { mode: "empty" }
  | { mode: "active"; mountId: string }
  | { mode: "minimized"; mountId: string }
  | { mode: "stopped"; mountId: string; reason: "unresponsive" | "kept leaving its page" };

export type ToolRuntime = {
  state(): RuntimeState;
  /** The running tool, if one is running and mounted. */
  current(): MountedTool | undefined;
  /** Runs the tool `mountId`, after disposing whatever ran before. Resolves once it's mounted. */
  open(mountId: string): Promise<MountedTool>;
  /** Disposes the running tool and remembers it as minimized. */
  minimize(): void;
  /** Runs the minimized or stopped tool again, from a fresh start. */
  restore(): Promise<MountedTool>;
  /** Disposes the running or minimized tool and forgets it. */
  close(): void;
  /** Calls `listen` with every new state; returns a way to stop. */
  onState(listen: (state: RuntimeState) => void): () => void;
};

/**
 * A runtime in `container`. Started from a saved state, a minimized or stopped tool stays as it
 * was and an active one is opened again. `watchdog` sets the watchdog's timings.
 */
export function createRuntime(
  container: HTMLElement,
  initial: RuntimeState = { mode: "empty" },
  appLocation: { protocol: string; port: string } = location,
  watchdog?: WatchdogOptions,
): ToolRuntime {
  let state: RuntimeState = { mode: "empty" };
  let tool: MountedTool | undefined;
  // A start still in progress is cancelled by the next open, minimize or close, which removes its
  // frame at once, so two tools never run together.
  let starting: AbortController | undefined;
  const listeners = new Set<(state: RuntimeState) => void>();

  const setState = (next: RuntimeState) => {
    state = next;
    listeners.forEach((listen) => listen(next));
  };
  const dispose = () => {
    starting?.abort();
    starting = undefined;
    tool?.unmount();
    tool = undefined;
  };

  const open = async (mountId: string): Promise<MountedTool> => {
    dispose();
    const mine = new AbortController();
    starting = mine;
    setState({ mode: "active", mountId });
    const mounted = await mountTool(container, mountId, appLocation, mine.signal, watchdog);
    // Started, but something else came first in the meantime: this one mustn't run.
    if (starting !== mine) {
      mounted.unmount();
      throw new Error("The tool's start was cancelled.");
    }
    starting = undefined;
    tool = mounted;
    mounted.onEvent((event) => {
      if (event !== "unresponsive" && event !== "stopped") return;
      if (tool !== mounted) return;
      dispose();
      const reason = event === "unresponsive" ? "unresponsive" : "kept leaving its page";
      setState({ mode: "stopped", mountId, reason });
    });
    return mounted;
  };

  const runtime: ToolRuntime = {
    state: () => state,
    current: () => tool,
    open,
    minimize: () => {
      if (state.mode !== "active") return;
      dispose();
      setState({ mode: "minimized", mountId: state.mountId });
    },
    restore: () => {
      if (state.mode !== "minimized" && state.mode !== "stopped") {
        return Promise.reject(new Error("There is no minimized or stopped tool to restore."));
      }
      return open(state.mountId);
    },
    close: () => {
      dispose();
      setState({ mode: "empty" });
    },
    onState: (listen) => {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
  };

  if (initial.mode === "minimized" || initial.mode === "stopped") setState(initial);
  // A failed start leaves the state active, as it would after open; the host app decides.
  if (initial.mode === "active") void open(initial.mountId).catch(() => {});
  return runtime;
}
