import { MOUNT_MESSAGE, runtimeOriginFor, TOOL_EVENTS, type ToolEvent } from "./protocol.ts";

// The host app's side of the runtime (RUN-01): it frames the wrapper on the opposite loopback name
// and talks to the tool only through a fresh MessageChannel bound to one instance. Its watchdog
// pings the tool's page and stops a tool that stopped answering (RUN-02).

/**
 * What the host hears about a tool beside its messages: the wrapper's events, and `unresponsive`
 * when the watchdog stopped a tool whose page no longer answered.
 */
export type MountEvent = ToolEvent | "unresponsive";

export type WatchdogOptions = {
  /** How often the tool's page is pinged. */
  pingMs?: number;
  /** How long a running tool may go without answering before it's stopped. */
  unresponsiveMs?: number;
  /** The same, while the tool is starting and hasn't answered yet. */
  startupMs?: number;
};

/** One ping a second; five seconds without an answer, ten while starting. */
export const WATCHDOG_DEFAULTS: Required<WatchdogOptions> = {
  pingMs: 1000,
  unresponsiveMs: 5000,
  startupMs: 10_000,
};

export type MountedTool = {
  /** The wrapper's frame, for layout. The tool runs in a sandboxed frame inside it. */
  frame: HTMLIFrameElement;
  /** This mount's instance; messages of any other instance are dropped. */
  instanceId: string;
  /** Sends a message to the tool. */
  send(message: unknown): void;
  /** Calls `listen` with every message from this instance of the tool; returns a way to stop. */
  onMessage(listen: (message: unknown) => void): () => void;
  /**
   * Calls `listen` when the tool left its page and was started again, losing what it held in
   * memory, or kept leaving it and was stopped (SBX-07), or stopped answering and was removed by
   * the watchdog (RUN-02); returns a way to stop.
   */
  onEvent(listen: (event: MountEvent) => void): () => void;
  /** Removes the tool, its frames and its channel. */
  unmount(): void;
};

/**
 * Mounts the tool the server knows as `mountId` inside `container`. Resolves once the wrapper has
 * loaded and holds the channel; the tool's own document follows on its own. Aborting `signal`
 * before then removes the frame and rejects, so a mount that is no longer wanted never runs.
 * The watchdog runs from the start, so a tool stuck while it starts is stopped too.
 */
export function mountTool(
  container: HTMLElement,
  mountId: string,
  appLocation: { protocol: string; port: string } = location,
  signal?: AbortSignal,
  watchdog: WatchdogOptions = {},
): Promise<MountedTool> {
  const limits = { ...WATCHDOG_DEFAULTS, ...watchdog };
  const runtimeOrigin = runtimeOriginFor(appLocation);
  const frame = document.createElement("iframe");
  frame.src = `${runtimeOrigin}/runtime/wrapper`;
  frame.title = "Tool";
  const instanceId = crypto.randomUUID();
  const channel = new MessageChannel();
  const listeners = new Set<(message: unknown) => void>();
  const eventListeners = new Set<(event: MountEvent) => void>();
  // Every listener there when the event happens hears it, even one that unmounts the tool first.
  const emit = (event: MountEvent) => [...eventListeners].forEach((listen) => listen(event));

  // The watchdog judges only pings it sent: a timer slowed down in a background tab makes it ping
  // less often, never makes a tool look stuck. Any answer clears the wait. Time is measured on a
  // clock that only moves forward, so setting the computer's clock can't stop a tool.
  let answered = false;
  let unansweredSince: number | undefined;
  let watching: ReturnType<typeof setInterval> | undefined;
  let ping = 0;
  // Set until the wrapper has loaded: a wrapper that never loads fails the start instead.
  let failStart: ((error: Error) => void) | undefined;
  const tick = () => {
    const now = performance.now();
    const limit = answered ? limits.unresponsiveMs : limits.startupMs;
    if (unansweredSince !== undefined && now - unansweredSince > limit) {
      stop();
      if (failStart) failStart(new Error("The tool didn't start."));
      else emit("unresponsive");
      return;
    }
    unansweredSince ??= now;
    ping += 1;
    channel.port1.postMessage({ instanceId, ping });
  };
  const stop = () => {
    clearInterval(watching);
    listeners.clear();
    channel.port1.close();
    frame.remove();
  };
  channel.port1.onmessage = (event: MessageEvent) => {
    const data = event.data as { instanceId?: unknown; message?: unknown; event?: unknown };
    if (data?.instanceId !== instanceId) return;
    // The wrapper's own events and the watchdog's answers sit beside the tool's messages, which
    // the tool can't reach: its preamble wraps them.
    if ("pong" in data) {
      answered = true;
      unansweredSince = undefined;
    } else if ("event" in data) {
      const toolEvent = TOOL_EVENTS.find((name) => name === data.event);
      if (toolEvent === "stopped") clearInterval(watching);
      // Started again, the tool gets the time a starting tool gets.
      if (toolEvent === "restarted") {
        answered = false;
        unansweredSince = undefined;
      }
      if (toolEvent) emit(toolEvent);
    } else {
      listeners.forEach((listen) => listen(data.message));
    }
  };
  return new Promise((resolve, reject) => {
    failStart = reject;
    const abort = () => {
      stop();
      reject(new Error("The tool's start was cancelled."));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    frame.addEventListener(
      "load",
      () => {
        signal?.removeEventListener("abort", abort);
        failStart = undefined;
        frame.contentWindow?.postMessage(
          { type: MOUNT_MESSAGE, mountId, instanceId },
          runtimeOrigin,
          [channel.port2],
        );
        resolve({
          frame,
          instanceId,
          send: (message) => channel.port1.postMessage({ instanceId, message }),
          onMessage: (listen) => {
            listeners.add(listen);
            return () => listeners.delete(listen);
          },
          onEvent: (listen) => {
            eventListeners.add(listen);
            return () => eventListeners.delete(listen);
          },
          unmount: () => {
            eventListeners.clear();
            stop();
          },
        });
      },
      { once: true },
    );
    container.append(frame);
    watching = setInterval(tick, limits.pingMs);
  });
}
