// Runs first in the tool's document, before the tool's own code (RUN-01). It says hello to the
// wrapper as the page loads, takes the one port the wrapper hands over in answer, and gives the tool
// `tessera`, its only way to talk to the host. The server inlines it, so it is a plain script: no
// imports, and the protocol names repeat src/protocol.ts.
(() => {
  const HELLO_MESSAGE = "tessera:hello";
  const PORT_MESSAGE = "tessera:port";
  const wrapper = parent;
  let port: MessagePort | undefined;
  const waiting: unknown[] = [];
  const listeners = new Set<(message: unknown) => void>();

  // Only the first port, from the wrapper that framed this document, is taken.
  addEventListener("message", (event: MessageEvent) => {
    if (port || event.source !== wrapper) return;
    const data = event.data as { type?: unknown };
    const given = event.ports[0];
    if (data?.type !== PORT_MESSAGE || !given) return;
    port = given;
    port.onmessage = (e: MessageEvent) => listeners.forEach((listen) => listen(e.data));
    for (const message of waiting.splice(0)) port.postMessage(message);
  });

  // Registered before the tool's code, so it runs first. A page in this frame that never says hello,
  // such as a blank or a blocked one, isn't the tool's: the wrapper starts the tool again (SBX-07).
  addEventListener("load", () => wrapper.postMessage({ type: HELLO_MESSAGE }, "*"), {
    capture: true,
    once: true,
  });

  Object.defineProperty(window, "tessera", {
    value: Object.freeze({
      /** Sends a message to the host; it waits until the bridge is ready. */
      send(message: unknown) {
        if (port) port.postMessage(message);
        else waiting.push(message);
      },
      /** Calls `listen` with every message from the host; returns a way to stop. */
      onMessage(listen: (message: unknown) => void) {
        listeners.add(listen);
        return () => listeners.delete(listen);
      },
    }),
    enumerable: true,
  });
})();
