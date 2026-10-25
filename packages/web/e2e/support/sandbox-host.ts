import diagnostics from "node:diagnostics_channel";
import fs from "node:fs";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { build, type Rolldown } from "vite";
import type { Artifact } from "../../../contracts/src/index.ts";
import { startLocalServer } from "../../../server/src/http/index.ts";
import { bridgeRoutes } from "../../../server/src/bridge/index.ts";
import { runtimeRoutes } from "../../../server/src/runtime/index.ts";
import { openDataFolder, type DataFolder } from "../../../server/src/storage/index.ts";
import { activationRoutes } from "../../../server/src/workspaces/index.ts";

// The sandbox's browser tests share this host (RUN-01, TEST-06): the real local server with its
// guard and runtime routes, a small page standing in for the host app that mounts tools with the
// runtime's own mountTool and serves the bridge with its serveBridge, and a probe server that
// stands in for the outside world. Every request either server receives is recorded, so a check
// can show that nothing arrived (SEC-05).

const runtimeEntry = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "runtime",
  "src",
  "index.ts",
);

// The runtime as one browser module, with the contracts and zod it imports, built once per worker.
let runtimeBundle: Promise<string> | undefined;
const bundleRuntime = () =>
  (runtimeBundle ??= build({
    configFile: false,
    logLevel: "silent",
    build: {
      lib: { entry: runtimeEntry, formats: ["es"], fileName: "runtime" },
      write: false,
      minify: false,
    },
  }).then((output) => {
    const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[];
    const chunk = outputs.flatMap((o) => o.output).find((o) => o.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw new Error("The runtime didn't build.");
    return chunk.code;
  }));

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
  /** With `data`, the temporary data folder the bridge route answers from (ENG-19). */
  folder: DataFolder | undefined;
  close(): Promise<void>;
};

/**
 * Starts the host. With `data`, it also opens a temporary data folder, never the real one
 * (ENG-19), and serves the server's bridge route from it, so tools can read and change saved data.
 */
/** A test tool: its code, which runs in custom mode, or its code with the UI mode it asks for. */
export type TestTool = Artifact["code"] | Pick<Artifact, "code" | "ui">;

// Plain code runs in custom mode: it gets the accessibility floor (RUN-05) but not the UI
// standard's look, so the boundary tests' tools keep exactly the styles they set.
const asTool = (tool: TestTool): Pick<Artifact, "code" | "ui"> =>
  "code" in tool ? tool : { code: tool, ui: { standardVersion: 1, mode: "custom" } };

export async function startSandboxHost(
  tools: Record<string, TestTool>,
  options: { data?: boolean } = {},
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
  fs.writeFileSync(path.join(webRoot, "runtime.js"), await bundleRuntime());
  // No favicon request, which would arrive at any time and look like a tool's. A task that blocks
  // the page for a second or more is logged, so a failed test's trace shows whether the page itself
  // stalled (#83, #98).
  fs.writeFileSync(
    path.join(webRoot, "index.html"),
    `<!doctype html><title>Sandbox test host</title><link rel="icon" href="data:,"><script>new PerformanceObserver((list) => { for (const task of list.getEntries()) if (task.duration >= 1000) console.warn(\`Host page blocked for \${Math.round(task.duration)} ms\`); }).observe({ type: "longtask", buffered: true });</script><script type="module">import { mountTool, createRuntime, serveBridge, serverData, stageCandidate, stubCheck } from "./runtime.js"; Object.assign(window, { mountTool, createRuntime, serveBridge, serverData, stageCandidate, stubCheck });</script>`,
  );
  const dataDir = options.data
    ? fs.mkdtempSync(path.join(os.tmpdir(), "tessera-sandbox-data-"))
    : undefined;
  const folder = dataDir ? await openDataFolder(dataDir) : undefined;
  const server = await startLocalServer({
    port: 0,
    webRoot,
    routes: {
      ...runtimeRoutes((id) => (tools[id] ? asTool(tools[id]) : undefined)),
      ...(folder ? { ...bridgeRoutes(folder), ...activationRoutes(folder) } : {}),
    },
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
    folder,
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
      folder?.close();
      if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
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

/**
 * The tool's frame, for a page with one tool: in the wrapper's frame, inside the page frame the
 * wrapper makes for each page of the tool.
 */
export const toolFrame = (page: Page) =>
  page.frameLocator("iframe").frameLocator("iframe").frameLocator("iframe");
/** The tool's frame element, in the wrapper's page frame. */
export const toolFrameElement = (page: Page) =>
  page.frameLocator("iframe").frameLocator("iframe").locator("iframe");

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
 * Waits until the tool has said `count` messages in all, for at most `maxWaitMs`, then
 * `settleMs` longer so anything late shows too, and returns what it said and the wrapper's events.
 * A check waiting on slow refusals answers late, but answers; one expecting silence passes a short
 * `maxWaitMs`.
 */
export const collect = (
  page: Page,
  count: number,
  settleMs = 1500,
  maxWaitMs = 60_000,
): Promise<{ messages: unknown[]; events: string[] }> =>
  page.evaluate(
    async ({ count, settleMs, maxWaitMs }) => {
      const w = window as unknown as TestWindow;
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let waited = 0; waited < maxWaitMs && w.messages.length < count; waited += 50) {
        await wait(50);
      }
      await wait(settleMs);
      return { messages: [...w.messages], events: [...w.events] };
    },
    { count, settleMs, maxWaitMs },
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
