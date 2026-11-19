import {
  MOUNT_MESSAGE,
  runtimeOriginFor,
  TOOL_EVENTS,
  TOOL_FRAME_PERMISSIONS,
  type DriveStep,
  type ToolEvent,
} from "./protocol.ts";

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
   * Calls `listen` with every bridge call from this instance, unchecked: whoever serves the
   * bridge checks it (RUN-04). Returns a way to stop.
   */
  onCall(listen: (call: unknown) => void): () => void;
  /** Sends the tool the reply to one of its calls. */
  reply(reply: unknown): void;
  /**
   * Calls `listen` when the person first clicks, taps or presses a key in the tool's page: real
   * input, which the tool's own code can't make (GEN-06). Once per page. Returns a way to stop.
   */
  onInteraction(listen: () => void): () => void;
  /**
   * Calls `listen` when the tool left its page and was started again, losing what it held in
   * memory, or kept leaving it and was stopped (SBX-07), or stopped answering and was removed by
   * the watchdog (RUN-02); returns a way to stop.
   */
  onEvent(listen: (event: MountEvent) => void): () => void;
  /**
   * Asks the tool's page what it showed and what went wrong as it started, for the smoke check
   * (VER-02). It answers once its bridge calls have settled. Like a pong, the report is only the
   * page's word: the tool's own code can reach the port.
   */
  inspect(timeoutMs?: number): Promise<unknown>;
  /**
   * Asks the tool's page to take `steps` on the elements it marks with hooks, for a behavior check
   * (VER-03), and answers with each step's result. Like `inspect`, the answer is the page's word.
   */
  drive(steps: readonly DriveStep[], timeoutMs?: number): Promise<unknown>;
  /** Removes the tool, its frames and its channel. */
  unmount(): void;
};

/** The most a tool's panel grows to fit its page, in CSS pixels (A89). */
export const FIT_MAX_PX = 4000;
/** How many times the panel follows the page's height on one allowance (A89). */
export const FIT_CHANGES = 4;
/** How long after the last held-back height, in ms, it is applied once, the page being quiet. */
export const FIT_QUIET_MS = 500;

/**
 * How the panel fits its tool's page (A89): the height applied, how many more changes this
 * allowance has, the latest height held back, and whether a held height was applied once already.
 */
export type Fit = {
  height?: number;
  left: number;
  pending?: number;
  settled: boolean;
};

/** A tool's first allowance, as it starts. */
export const NEW_FIT: Fit = { left: FIT_CHANGES, settled: false };

/**
 * The fit after the page says how tall it is (A89). The page's word is the tool's, so it is
 * bounded: anything but a positive number is dropped, and the height is `FIT_MAX_PX` at most. A
 * page whose height depends on its frame's, as one made to fill its window, answers each resize
 * with a new height, growing for ever or flipping between two, however fast or slow; no timing
 * tells that from a tool's own changes. So the panel follows the page `FIT_CHANGES` times on each
 * allowance, which the tool's start and the person's use of it give (`allowFit`), and holds back
 * the heights after that, the tool scrolling in its frame as before; `settleFit` applies the last
 * once, when the page is quiet.
 */
export function nextFit(fit: Fit, reported: unknown): Fit {
  const value = (reported as { height?: unknown } | null)?.height;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fit;
  const height = Math.min(Math.ceil(value), FIT_MAX_PX);
  if (height === fit.height) return { ...fit, pending: undefined };
  if (fit.left > 0) return { height, left: fit.left - 1, settled: fit.settled };
  return { ...fit, pending: height };
}

/**
 * The fit once the page has been quiet for `FIT_QUIET_MS` after a held-back height: that height is
 * applied, once an allowance, so rows that came in quick steps end at their full height. A page
 * that follows its frame answers it again, and that answer waits for the next allowance.
 */
export function settleFit(fit: Fit): Fit {
  if (fit.pending === undefined || fit.settled) return fit;
  return { height: fit.pending, left: 0, settled: true };
}

/**
 * The fit after the person used the tool (A89): a new allowance of one change, and a settling
 * after it, out of the tool's reach, since only the wrapper sees real input, and it says so at most
 * once a second. A height held back is applied now, as that change. So rows the person adds keep
 * fitting, and a page whose height follows its frame changes it at most twice a second, and only
 * while the person uses it.
 */
export function allowFit(fit: Fit): Fit {
  if (fit.pending === undefined) return { ...fit, left: 1, settled: false };
  return { height: fit.pending, left: 0, settled: false };
}

/** The CSS variable on the tool's frame that holds its fitted height; the host app's CSS uses it. */
export const FIT_HEIGHT_PROPERTY = "--tool-fit-height";

/**
 * Mounts the tool the server knows as `mountId` inside `container`. Resolves once the wrapper has
 * loaded and holds the channel; the tool's own document follows on its own. Aborting `signal`
 * before then removes the frame and rejects, so a mount that is no longer wanted never runs.
 * The watchdog runs from the start, so a tool stuck while it starts is stopped too. A tool mounted
 * for a check (`checked`) may not show dialogs or use the clipboard, and its page answers a
 * confirm yes, as the person the check acts for would (A92).
 */
export function mountTool(
  container: HTMLElement,
  mountId: string,
  appLocation: { protocol: string; port: string } = location,
  signal?: AbortSignal,
  watchdog: WatchdogOptions = {},
  checked = false,
): Promise<MountedTool> {
  const limits = { ...WATCHDOG_DEFAULTS, ...watchdog };
  const runtimeOrigin = runtimeOriginFor(appLocation);
  const frame = document.createElement("iframe");
  // The person's tool may copy and paste in its own window; one mounted for a check may not (A92).
  if (!checked) frame.allow = TOOL_FRAME_PERMISSIONS;
  frame.src = `${runtimeOrigin}/runtime/wrapper`;
  frame.title = "Tool";
  const instanceId = crypto.randomUUID();
  const channel = new MessageChannel();
  const listeners = new Set<(message: unknown) => void>();
  const callListeners = new Set<(call: unknown) => void>();
  const interactionListeners = new Set<() => void>();
  const eventListeners = new Set<(event: MountEvent) => void>();
  const reports = new Map<number, (report: unknown) => void>();
  let inspections = 0;
  // A check's question, answered by a report with its number, or refused after `timeoutMs`.
  const ask = (question: (id: number) => object, timeoutMs: number) =>
    new Promise<unknown>((answer, refuse) => {
      inspections += 1;
      const id = inspections;
      reports.set(id, answer);
      channel.port1.postMessage({ instanceId, ...question(id) });
      setTimeout(() => {
        if (reports.delete(id)) refuse(new Error("The tool didn't answer the check."));
      }, timeoutMs);
    });
  // The frame's fit to its page (A89), and the wait before a held-back height is applied.
  let fit: Fit = NEW_FIT;
  let settling: ReturnType<typeof setTimeout> | undefined;
  const fitTo = (next: Fit) => {
    const changed = next.height !== fit.height;
    fit = next;
    if (changed && fit.height !== undefined) {
      frame.style.setProperty(FIT_HEIGHT_PROPERTY, `${fit.height}px`);
    }
  };
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
    clearTimeout(settling);
    listeners.clear();
    callListeners.clear();
    interactionListeners.clear();
    channel.port1.close();
    frame.remove();
  };
  channel.port1.onmessage = (event: MessageEvent) => {
    const data = event.data as {
      instanceId?: unknown;
      message?: unknown;
      event?: unknown;
      call?: unknown;
      report?: unknown;
    };
    if (data?.instanceId !== instanceId) return;
    // The wrapper's own events, the watchdog's answers, bridge calls and the first interaction sit
    // beside the tool's messages. A pong or a call is only the tool's word: its code can reach its
    // port. The events and the interaction come from the wrapper alone, out of the tool's reach.
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
        // A new page of the tool starts with a new allowance to fit it (A89).
        fitTo(allowFit(fit));
      }
      if (toolEvent) emit(toolEvent);
    } else if ("call" in data) {
      callListeners.forEach((listen) => listen(data.call));
    } else if ("report" in data) {
      const report = data["report"] as { id?: unknown } | null;
      const answer = typeof report?.id === "number" ? reports.get(report.id) : undefined;
      if (answer && report) {
        reports.delete(report.id as number);
        answer(report);
      }
    } else if ("interacted" in data) {
      interactionListeners.forEach((listen) => listen());
    } else if ("used" in data) {
      // The person used the tool, as the wrapper saw it: a new allowance to fit it (A89).
      clearTimeout(settling);
      fitTo(allowFit(fit));
    } else if ("size" in data) {
      fitTo(nextFit(fit, data["size"]));
      // A height held back is applied once the page has been quiet (settleFit).
      clearTimeout(settling);
      if (fit.pending !== undefined && !fit.settled) {
        settling = setTimeout(() => fitTo(settleFit(fit)), FIT_QUIET_MS);
      }
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
          { type: MOUNT_MESSAGE, mountId, instanceId, checked },
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
          onCall: (listen) => {
            callListeners.add(listen);
            return () => callListeners.delete(listen);
          },
          reply: (reply) => channel.port1.postMessage({ instanceId, reply }),
          onInteraction: (listen) => {
            interactionListeners.add(listen);
            return () => interactionListeners.delete(listen);
          },
          onEvent: (listen) => {
            eventListeners.add(listen);
            return () => eventListeners.delete(listen);
          },
          // Long enough for the frame's own wait for its first draw, up to 30 s on a cold browser,
          // and its size and settling after it (#337).
          inspect: (timeoutMs = 45_000) => ask((id) => ({ inspect: id }), timeoutMs),
          drive: (steps, timeoutMs = 60_000) => ask((id) => ({ drive: { id, steps } }), timeoutMs),
          unmount: () => {
            eventListeners.clear();
            reports.clear();
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
