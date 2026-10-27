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

  // Each page of the tool runs in a frame of its own (toolFrame), inside a blank frame of this
  // wrapper's origin made for that page alone (pageFrame): see "Real input" below.
  let pageFrame: HTMLIFrameElement | undefined;
  let toolFrame: HTMLIFrameElement | undefined;
  let hostPort: MessagePort | undefined;
  let toolPort: MessagePort | undefined;
  let onHello: (() => void) | undefined;
  // The host's messages that came before the tool's page was ready for them, in order.
  let waiting: unknown[] = [];
  // The request IDs of the current page's calls still waiting for a reply.
  let calls = new Set<string>();
  // The smoke check's question, if it came before the tool's page was ready (VER-02).
  let inspecting: unknown;
  // Watches for the person's first real input in the tool's page (GEN-06).
  let watchingInput: ReturnType<typeof setInterval> | undefined;
  let checkInput: (() => void) | undefined;

  const unmountTool = () => {
    toolPort?.close();
    toolPort = undefined;
    pageFrame?.remove();
    pageFrame = undefined;
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
    // The tool's page says hello to its page frame, not here; anything it sends here is dropped.
    if (toolFrame?.contentWindow && event.source === toolFrame.contentWindow) return;
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
        inspect?: unknown;
      };
      if (data?.instanceId !== instanceId) return;
      // The smoke check's question (VER-02): it waits for the page if there is none yet.
      if ("inspect" in data) {
        if (toolPort) toolPort.postMessage({ inspect: data.inspect });
        else inspecting = data.inspect;
        return;
      }
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
      // A blank srcdoc frame of this origin, for this page alone. Being srcdoc, the tool's request
      // from it carries the wrapper's address as its referrer, as the server's guard expects; a
      // plain blank frame's would carry none. Its policy is the wrapper's, which allows no inline
      // styles, so it is sized through style properties once it has loaded.
      const page = document.createElement("iframe");
      page.title = "Tool";
      page.srcdoc = "<!doctype html><html><body></body></html>";
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
      // anything on its port, so the page's word proves nothing. The browser activates a frame and
      // every frame around it when the person clicks, taps or types in it (user activation), and
      // nothing else does: not the tool's own clicks and events, nor input on the host page, which
      // doesn't reach frames of another origin. The page frame is new for each page of the tool,
      // so its sticky activation (hasBeenActive) says the person used this page, not one before
      // it: a click on a page the tool left, still active for a few seconds, doesn't count, and a
      // click on this page counts at once.
      let interacted = false;
      checkInput = () => {
        if (interacted || !page.contentWindow?.navigator.userActivation.hasBeenActive) return;
        interacted = true;
        hostPort?.postMessage({ instanceId, interacted: true });
      };
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
          const data = e.data as {
            message?: unknown;
            pong?: unknown;
            call?: unknown;
            report?: unknown;
          };
          if (data && "pong" in data) hostPort?.postMessage({ instanceId, pong: data.pong });
          else if (data && "report" in data)
            hostPort?.postMessage({ instanceId, report: data.report });
          else if (data && "call" in data) {
            const id = (data.call as { requestId?: unknown } | null)?.requestId;
            if (typeof id === "string") calls.add(id);
            hostPort?.postMessage({ instanceId, call: data.call });
          } else hostPort?.postMessage({ instanceId, message: data?.message });
        };
        // The tool's origin is opaque, so "*" is the only target; the port goes to this frame only.
        frame.contentWindow.postMessage({ type: PORT_MESSAGE, instanceId }, "*", [channel.port2]);
        for (const message of waiting.splice(0)) toolPort.postMessage({ message });
        if (inspecting !== undefined) toolPort.postMessage({ inspect: inspecting });
        inspecting = undefined;
      };
      frame.addEventListener("load", () => {
        if (toolFrame !== frame) return;
        loads += 1;
        setTimeout(() => {
          if (loads > hellos) leave();
        }, HELLO_GRACE_MS);
      });
      frame.style.border = "0";
      frame.style.width = "100%";
      frame.style.height = "100%";
      frame.style.display = "block";
      pageFrame = page;
      toolFrame = frame;
      page.addEventListener(
        "load",
        () => {
          const pageWindow = page.contentWindow;
          if (toolFrame !== frame || !pageWindow) return;
          const { documentElement, body } = pageWindow.document;
          documentElement.style.height = "100%";
          body.style.margin = "0";
          body.style.height = "100%";
          // The page in the tool's own frame says hello to its parent, the page frame; a frame
          // nested inside it can't.
          pageWindow.addEventListener("message", (event: MessageEvent) => {
            if (!frame.contentWindow || event.source !== frame.contentWindow) return;
            if ((event.data as { type?: unknown })?.type === HELLO_MESSAGE) onHello?.();
          });
          watchingInput = setInterval(() => checkInput?.(), 100);
          body.append(frame);
        },
        { once: true },
      );
      document.body.replaceChildren(page);
    };
    start();
  }
})();
