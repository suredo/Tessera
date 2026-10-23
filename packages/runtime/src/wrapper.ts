// The wrapper document's script, on the runtime's origin (localhost), between the host app
// (127.0.0.1) and the tool (RUN-01). The server inlines it, so it is a plain script: no imports,
// and the protocol names repeat src/protocol.ts (a test keeps them equal).
(() => {
  const MOUNT_MESSAGE = "tessera:mount";
  const HELLO_MESSAGE = "tessera:hello";
  const PORT_MESSAGE = "tessera:port";
  const MAX_RESTARTS = 3;
  // How long after the tool's frame loads its page may take to say hello.
  const HELLO_GRACE_MS = 1000;
  const appOrigin = `${location.protocol}//127.0.0.1:${location.port}`;

  let toolFrame: HTMLIFrameElement | undefined;
  let hostPort: MessagePort | undefined;
  let toolPort: MessagePort | undefined;
  let onHello: (() => void) | undefined;
  // The host's messages that came before the tool's page was ready for them, in order.
  let waiting: unknown[] = [];
  // The request IDs of the current page's calls still waiting for a reply.
  let calls = new Set<string>();
  // Watches for the person's first real input in the tool's page (GEN-06).
  let watchingInput: ReturnType<typeof setInterval> | undefined;
  let checkInput: (() => void) | undefined;

  const unmountTool = () => {
    toolPort?.close();
    toolPort = undefined;
    toolFrame?.remove();
    toolFrame = undefined;
    onHello = undefined;
    calls = new Set();
    clearInterval(watchingInput);
    checkInput = undefined;
  };
  const unmount = () => {
    unmountTool();
    hostPort?.close();
    hostPort = undefined;
    waiting = [];
  };

  addEventListener("message", (event: MessageEvent) => {
    // The page in the tool's own frame says hello; a frame nested inside it can't.
    if (toolFrame?.contentWindow && event.source === toolFrame.contentWindow) {
      if ((event.data as { type?: unknown })?.type === HELLO_MESSAGE) onHello?.();
      return;
    }
    // Only the host app's page that framed this wrapper may mount a tool, with a port of its own.
    if (event.origin !== appOrigin || event.source !== parent) return;
    const data = event.data as { type?: unknown; mountId?: unknown; instanceId?: unknown };
    const port = event.ports[0];
    if (data?.type !== MOUNT_MESSAGE || typeof data.mountId !== "string" || !port) return;
    if (typeof data.instanceId !== "string") return;
    mount(data.mountId, data.instanceId, port);
  });

  function mount(mountId: string, instanceId: string, port: MessagePort) {
    unmount();
    hostPort = port;
    port.onmessage = (e: MessageEvent) => {
      const data = e.data as {
        instanceId?: unknown;
        message?: unknown;
        ping?: unknown;
        reply?: unknown;
      };
      if (data?.instanceId !== instanceId) return;
      // The host's watchdog pings the tool's page; with no page ready yet, the ping goes nowhere
      // and the watchdog sends another (RUN-02). A reply goes on only to the page that made the
      // call, once: a reply for a page the tool has left goes nowhere.
      if ("ping" in data) toolPort?.postMessage({ ping: data.ping });
      else if ("reply" in data) {
        const id = (data.reply as { requestId?: unknown } | null)?.requestId;
        if (typeof id === "string" && calls.delete(id))
          toolPort?.postMessage({ reply: data.reply });
      } else if (toolPort) toolPort.postMessage({ message: data.message });
      else waiting.push(data.message);
    };
    let restarts = 0;
    const start = () => {
      unmountTool();
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.title = "Tool";
      // From a host of its own for this start, so it runs in a process of its own (RUN-02).
      const label = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      frame.src = `${location.protocol}//t${label}.${location.hostname}:${location.port}/runtime/tool?mount=${encodeURIComponent(mountId)}`;
      // Each page of the tool loads once and says hello once. A load with no hello, or a second
      // hello, means the tool left its page (SBX-07). The server keeps a tool in place when it asks
      // for a runtime document, so this is a page it may not leave for, such as a blank or a blocked
      // one. That page gets no port; the tool starts again in a fresh frame, a few times at most.
      let loads = 0;
      let hellos = 0;
      let left = false;
      // Real input (GEN-06). The tool's code shares its page with the preamble and can send
      // anything on its port, so the page's word proves nothing. The browser marks this wrapper as
      // activated when the person clicks, taps or types in the tool, a frame inside it, and only
      // then: not for the tool's own clicks and events, nor for input on the host page. Activation
      // lasts a few seconds, so input that came before this page started (it was restarted just
      // after a click) is let pass first: only activation that starts while this page runs counts.
      let interacted = false;
      let armed = !navigator.userActivation.isActive;
      checkInput = () => {
        if (interacted) return;
        if (!navigator.userActivation.isActive) armed = true;
        else if (armed) {
          interacted = true;
          hostPort?.postMessage({ instanceId, interacted: true });
        }
      };
      watchingInput = setInterval(() => checkInput?.(), 100);
      const leave = () => {
        if (left || toolFrame !== frame) return;
        left = true;
        if (restarts < MAX_RESTARTS) {
          restarts += 1;
          hostPort?.postMessage({ instanceId, event: "restarted" });
          start();
        } else {
          unmountTool();
          hostPort?.postMessage({ instanceId, event: "stopped" });
        }
      };
      onHello = () => {
        hellos += 1;
        if (hellos > 1 || !frame.contentWindow) return leave();
        // The tool's page gets one fresh port, bound to this frame and this instance.
        const channel = new MessageChannel();
        toolPort = channel.port1;
        // The preamble's envelopes: a pong, a call, or a message. Input is checked first, so a
        // write the person's click caused reaches the host after the click does.
        toolPort.onmessage = (e: MessageEvent) => {
          checkInput?.();
          const data = e.data as { message?: unknown; pong?: unknown; call?: unknown };
          if (data && "pong" in data) hostPort?.postMessage({ instanceId, pong: data.pong });
          else if (data && "call" in data) {
            const id = (data.call as { requestId?: unknown } | null)?.requestId;
            if (typeof id === "string") calls.add(id);
            hostPort?.postMessage({ instanceId, call: data.call });
          } else hostPort?.postMessage({ instanceId, message: data?.message });
        };
        // The tool's origin is opaque, so "*" is the only target; the port goes to this frame only.
        frame.contentWindow.postMessage({ type: PORT_MESSAGE, instanceId }, "*", [channel.port2]);
        for (const message of waiting.splice(0)) toolPort.postMessage({ message });
      };
      frame.addEventListener("load", () => {
        if (toolFrame !== frame) return;
        loads += 1;
        setTimeout(() => {
          if (loads > hellos) leave();
        }, HELLO_GRACE_MS);
      });
      toolFrame = frame;
      document.body.replaceChildren(frame);
    };
    start();
  }
})();
