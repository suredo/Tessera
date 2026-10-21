import diagnostics from "node:diagnostics_channel";
import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { Artifact } from "../../../contracts/src/index.ts";
import { startLocalServer } from "../../../server/src/http/index.ts";
import { runtimeRoutes } from "../../../server/src/runtime/index.ts";

// The sandbox's browser tests share this host (RUN-01, TEST-06): the real local server with its
// guard and runtime routes, a small page standing in for the host app that mounts tools with the
// runtime's own mountTool, and a probe server that stands in for the outside world. Every request
// either server receives is recorded, so a check can show that nothing arrived (SEC-05).

const runtimeSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "runtime",
  "src",
);

export type SandboxHost = {
  /** The host app's address, http://127.0.0.1:<port>. */
  url: string;
  port: number;
  /** The probe server's address, ending in "/". */
  probeUrl: string;
  /** Requests the local server received, on either loopback name, since the last reset. */
  hostRequests: string[];
  /** Connections the local server accepted since the last reset, whether or not a request came. */
  hostConnections: () => number;
  /** Requests the probe server received since the last reset. */
  probeRequests: string[];
  /**
   * Connections the probe server accepted since the last reset, whether or not a request came on
   * them: Chrome and Edge connect before a blocked frame navigation is refused (issue 72).
   */
  probeConnections: () => number;
  /** Forgets what both servers received so far. */
  reset(): void;
  close(): Promise<void>;
};

export async function startSandboxHost(
  tools: Record<string, Artifact["code"]>,
): Promise<SandboxHost> {
  let connections = 0;
  const probeRequests: string[] = [];
  const probe = http.createServer((req, res) => {
    probeRequests.push(`${req.method} ${req.url}`);
    res.end("probe");
  });
  probe.on("connection", () => (connections += 1));
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));

  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-sandbox-host-"));
  const strip = (file: string) =>
    stripTypeScriptTypes(fs.readFileSync(path.join(runtimeSrc, file), "utf8")).replace(
      /from "\.\/(\w+)\.ts"/g,
      'from "./$1.js"',
    );
  fs.writeFileSync(path.join(webRoot, "protocol.js"), strip("protocol.ts"));
  fs.writeFileSync(path.join(webRoot, "host.js"), strip("host.ts"));
  // No favicon request, which would arrive at any time and look like a tool's.
  fs.writeFileSync(
    path.join(webRoot, "index.html"),
    `<!doctype html><title>Sandbox test host</title><link rel="icon" href="data:,"><script type="module">import { mountTool } from "./host.js"; window.mountTool = mountTool;</script>`,
  );
  const server = await startLocalServer({
    port: 0,
    webRoot,
    routes: runtimeRoutes((id) => tools[id]),
  });

  // Node announces every request its HTTP servers receive, and every connection its servers
  // accept; keep this server's.
  const hostRequests: string[] = [];
  let hostConnections = 0;
  const record = (message: unknown) => {
    const request = (message as { request: IncomingMessage }).request;
    if (request.socket.localPort === server.port) {
      hostRequests.push(`${request.method} ${request.headers.host} ${request.url}`);
    }
  };
  const count = (message: unknown) => {
    if ((message as { socket: Socket }).socket.localPort === server.port) hostConnections += 1;
  };
  diagnostics.subscribe("http.server.request.start", record);
  diagnostics.subscribe("net.server.socket", count);

  return {
    url: server.url,
    port: server.port,
    probeUrl: `http://127.0.0.1:${(probe.address() as AddressInfo).port}/`,
    hostRequests,
    hostConnections: () => hostConnections,
    probeRequests,
    probeConnections: () => connections,
    reset: () => {
      hostRequests.length = 0;
      hostConnections = 0;
      probeRequests.length = 0;
      connections = 0;
    },
    close: async () => {
      diagnostics.unsubscribe("http.server.request.start", record);
      diagnostics.unsubscribe("net.server.socket", count);
      await server.close();
      probe.closeAllConnections();
      await new Promise((resolve) => probe.close(resolve));
      fs.rmSync(webRoot, { recursive: true, force: true });
    },
  };
}

type Mounted = {
  send(message: unknown): void;
  onMessage(listen: (message: unknown) => void): () => void;
  onEvent(listen: (event: string) => void): () => void;
};
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<Mounted>;
  tool: Mounted;
  messages: unknown[];
  events: string[];
};

/** Opens the test host page and mounts a tool, keeping everything it says and every event. */
export async function mount(page: Page, host: SandboxHost, mountId: string): Promise<void> {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  await page.evaluate(async (mountId) => {
    const w = window as unknown as TestWindow;
    w.messages = [];
    w.events = [];
    w.tool = await w.mountTool(document.body, mountId);
    w.tool.onMessage((message) => w.messages.push(message));
    w.tool.onEvent((event) => w.events.push(event));
  }, mountId);
}

/** Sends the mounted tool a message. */
export const send = (page: Page, message: unknown): Promise<void> =>
  page.evaluate((message) => (window as unknown as TestWindow).tool.send(message), message);

/**
 * Waits until the tool has said `count` messages in all, then a while longer so anything late
 * shows too, and returns what it said and the wrapper's events.
 */
export const collect = (
  page: Page,
  count: number,
  settleMs = 1500,
): Promise<{ messages: unknown[]; events: string[] }> =>
  page.evaluate(
    async ({ count, settleMs }) => {
      const w = window as unknown as TestWindow;
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 200 && w.messages.length < count; i += 1) await wait(50);
      await wait(settleMs);
      return { messages: [...w.messages], events: [...w.events] };
    },
    { count, settleMs },
  );

/** Mounts a tool, sends it one message and collects what it says. */
export async function ask(
  page: Page,
  host: SandboxHost,
  mountId: string,
  message: unknown,
  replies: number,
): Promise<{ messages: unknown[]; events: string[] }> {
  await mount(page, host, mountId);
  await send(page, message);
  return collect(page, replies);
}
