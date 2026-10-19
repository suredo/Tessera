// The wrapper document's script, on the runtime's origin (localhost), between the host app
// (127.0.0.1) and the tool (RUN-01). The server inlines it, so it is a plain script: no imports,
// and the protocol names repeat src/protocol.ts (a test keeps them equal).
(() => {
  const MOUNT_MESSAGE = "tessera:mount";
  const PORT_MESSAGE = "tessera:port";
  const appOrigin = `${location.protocol}//127.0.0.1:${location.port}`;

  let toolFrame: HTMLIFrameElement | undefined;
  let hostPort: MessagePort | undefined;
  let toolPort: MessagePort | undefined;

  const unmount = () => {
    hostPort?.close();
    toolPort?.close();
    hostPort = toolPort = undefined;
    toolFrame?.remove();
    toolFrame = undefined;
  };

  // Only the host app's page that framed this wrapper may mount a tool, with a port of its own.
  addEventListener("message", (event: MessageEvent) => {
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
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.title = "Tool";
    frame.src = `/runtime/tool?mount=${encodeURIComponent(mountId)}`;
    // The tool's first document gets one fresh port, bound to this frame and this instance. If the
    // tool later reloads or navigates its frame, the new document gets no port.
    frame.addEventListener(
      "load",
      () => {
        if (toolFrame !== frame || !frame.contentWindow) return;
        const channel = new MessageChannel();
        toolPort = channel.port1;
        toolPort.onmessage = (e: MessageEvent) =>
          hostPort?.postMessage({ instanceId, message: e.data as unknown });
        // The tool's origin is opaque, so "*" is the only target; the port goes to this frame only.
        frame.contentWindow.postMessage({ type: PORT_MESSAGE, instanceId }, "*", [channel.port2]);
      },
      { once: true },
    );
    port.onmessage = (e: MessageEvent) => {
      const data = e.data as { instanceId?: unknown; message?: unknown };
      if (data?.instanceId === instanceId) toolPort?.postMessage(data.message);
    };
    toolFrame = frame;
    document.body.replaceChildren(frame);
  }
})();
