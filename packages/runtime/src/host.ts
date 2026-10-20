import { MOUNT_MESSAGE, runtimeOriginFor, TOOL_EVENTS, type ToolEvent } from "./protocol.ts";

// The host app's side of the runtime (RUN-01): it frames the wrapper on the opposite loopback name
// and talks to the tool only through a fresh MessageChannel bound to one instance.

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
   * memory, or kept leaving it and was stopped (SBX-07); returns a way to stop.
   */
  onEvent(listen: (event: ToolEvent) => void): () => void;
  /** Removes the tool, its frames and its channel. */
  unmount(): void;
};

/**
 * Mounts the tool the server knows as `mountId` inside `container`. Resolves once the wrapper has
 * loaded and holds the channel; the tool's own document follows on its own.
 */
export function mountTool(
  container: HTMLElement,
  mountId: string,
  appLocation: { protocol: string; port: string } = location,
): Promise<MountedTool> {
  const runtimeOrigin = runtimeOriginFor(appLocation);
  const frame = document.createElement("iframe");
  frame.src = `${runtimeOrigin}/runtime/wrapper`;
  frame.title = "Tool";
  const instanceId = crypto.randomUUID();
  const channel = new MessageChannel();
  const listeners = new Set<(message: unknown) => void>();
  const eventListeners = new Set<(event: ToolEvent) => void>();
  channel.port1.onmessage = (event: MessageEvent) => {
    const data = event.data as { instanceId?: unknown; message?: unknown; event?: unknown };
    if (data?.instanceId !== instanceId) return;
    // The wrapper's own events sit beside the tool's messages, which the tool can't reach.
    if ("event" in data) {
      const toolEvent = TOOL_EVENTS.find((name) => name === data.event);
      if (toolEvent) eventListeners.forEach((listen) => listen(toolEvent));
    } else {
      listeners.forEach((listen) => listen(data.message));
    }
  };
  return new Promise((resolve) => {
    frame.addEventListener(
      "load",
      () => {
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
            listeners.clear();
            eventListeners.clear();
            channel.port1.close();
            frame.remove();
          },
        });
      },
      { once: true },
    );
    container.append(frame);
  });
}
