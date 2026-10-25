// Runs first in the tool's document, before the tool's own code (RUN-01). It says hello to the
// wrapper as the page loads, takes the one port the wrapper hands over in answer, and gives the tool
// `tessera`, its only way to talk to the host. The server inlines it, so it is a plain script: no
// imports, and the protocol names repeat src/protocol.ts.
(() => {
  const HELLO_MESSAGE = "tessera:hello";
  const PORT_MESSAGE = "tessera:port";
  // The tool's frame sits in a page frame of the wrapper's own, made for this page alone: the
  // page says hello to that frame, its parent, and takes its port from the wrapper around it.
  const pageFrame = parent;
  const wrapper = parent.parent;
  let port: MessagePort | undefined;
  // What the page says before it has its port, in order, each in its envelope.
  const waiting: object[] = [];
  const listeners = new Set<(message: unknown) => void>();
  type Pending = { resolve(result: unknown): void; reject(error: Error): void };
  const pending = new Map<string, Pending>();
  // Request IDs start with a mark of this page, so a late reply for a page the tool left can't
  // settle a call of the page that replaced it (SBX-07).
  const page = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let lastCall = 0;

  // A waiting envelope is copied now, as the port would copy it, so what can't be sent fails here,
  // and a later change to it by the tool doesn't change what is sent.
  const post = (envelope: object) => {
    if (port) port.postMessage(envelope);
    else waiting.push(structuredClone(envelope));
  };

  // Only the first port, from the wrapper, is taken.
  addEventListener("message", (event: MessageEvent) => {
    if (port || event.source !== wrapper) return;
    const data = event.data as { type?: unknown };
    const given = event.ports[0];
    if (data?.type !== PORT_MESSAGE || !given) return;
    port = given;
    // On the port, the host's messages come as { message }, replies to calls as { reply }, and the
    // watchdog's pings as { ping }, which is answered at once: an answer shows the tool's page
    // isn't stuck (RUN-02). The tool's code shares this window and can reach the port too, so
    // nothing sent on it proves more than the tool says: the wrapper sees real input itself.
    port.onmessage = (e: MessageEvent) => {
      const data = e.data as { message?: unknown; ping?: unknown; reply?: unknown };
      if (data && "ping" in data) port?.postMessage({ pong: data.ping });
      else if (data && "reply" in data) settle(data.reply);
      else listeners.forEach((listen) => listen(data?.message));
    };
    for (const envelope of waiting.splice(0)) port.postMessage(envelope);
  });

  // A reply settles the call it names; any other is dropped.
  function settle(reply: unknown) {
    const r = reply as {
      requestId?: unknown;
      ok?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown };
    } | null;
    const call = typeof r?.requestId === "string" ? pending.get(r.requestId) : undefined;
    if (!call || !r) return;
    pending.delete(r.requestId as string);
    if (r.ok === true) return call.resolve(r.result);
    const message = r.error?.message;
    const error = new Error(typeof message === "string" ? message : "The host refused the call.");
    call.reject(Object.assign(error, { code: r.error?.code }));
  }

  // Registered before the tool's code, so it runs first. A page in this frame that never says hello,
  // such as a blank or a blocked one, isn't the tool's: the wrapper starts the tool again (SBX-07).
  addEventListener("load", () => pageFrame.postMessage({ type: HELLO_MESSAGE }, "*"), {
    capture: true,
    once: true,
  });

  Object.defineProperty(window, "tessera", {
    value: Object.freeze({
      /** Sends a message to the host; it waits until the bridge is ready. */
      send(message: unknown) {
        post({ message });
      },
      /** Calls `listen` with every message from the host; returns a way to stop. */
      onMessage(listen: (message: unknown) => void) {
        listeners.add(listen);
        return () => listeners.delete(listen);
      },
      call,
      /**
       * A blob: URL showing the image `id` names, from the host's asset.read (DATA-11): the tool
       * gets bytes and a type, never a file path. Rejects as call does.
       */
      async assetUrl(id: string): Promise<string> {
        const { type, bytesBase64 } = (await call("asset.read", { id })) as {
          type: string;
          bytesBase64: string;
        };
        const text = atob(bytesBase64);
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type }));
      },
    }),
    enumerable: true,
  });

  /**
   * Asks the host to do `action` (CON-03); resolves with its result, or rejects with an error
   * whose `code` says why it was refused.
   */
  function call(action: string, args: unknown = {}): Promise<unknown> {
    lastCall += 1;
    const requestId = `p${page}-c${lastCall}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        post({ call: { requestId, action, args } });
      } catch (error) {
        // Something the port can't carry, such as a function.
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("The call couldn't be sent."));
      }
    });
  }
})();
