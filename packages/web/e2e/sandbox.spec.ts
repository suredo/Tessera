import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startLocalServer, type LocalServer } from "../../server/src/http/index.ts";
import { runtimeRoutes } from "../../server/src/runtime/index.ts";

// The sandboxed runtime in a real browser (RUN-01, TEST-06): the local server with its guard, the
// wrapper on the opposite loopback name and the tool in its sandboxed frame. A small test host page
// stands in for the host app, using the runtime's own mountTool.
const runtimeSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "runtime",
  "src",
);
const tools: Record<string, Artifact["code"]> = {
  echo: {
    html: "<p>Echo</p>",
    css: "",
    js: "tessera.send({ origin: self.origin }); tessera.onMessage((m) => tessera.send({ echo: m }));",
  },
  // Says hello with a name for this run of its page, counts, and leaves its page when asked.
  wanderer: {
    html: "<p>Wanderer</p>",
    css: "",
    js: `const run = Math.random().toString(36).slice(2); let count = 0;
tessera.send({ run });
tessera.onMessage((m) => {
  if (m === "count") return tessera.send({ run, count: ++count });
  if (m.by === "assigning") location.href = m.to;
  if (m.by === "reloading") location.reload();
  if (m.by === "link") { const a = document.createElement("a"); a.href = m.to; a.textContent = "go"; document.body.append(a); a.click(); }
  if (m.by === "refresh") { const meta = document.createElement("meta"); meta.httpEquiv = "refresh"; meta.content = "0;url=" + m.to; document.head.append(meta); }
});`,
  },
  // Leaves its page as soon as it starts.
  runaway: { html: "<p>Runaway</p>", css: "", js: 'location.href = "about:blank";' },
};

let server: LocalServer;
let webRoot: string;
// Stands in for the outside world: nothing a tool does may reach it.
let probe: http.Server;
let probeHits = 0;
test.beforeAll(async () => {
  probe = http.createServer((_req, res) => {
    probeHits += 1;
    res.end("probe");
  });
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-sandbox-host-"));
  const strip = (file: string) =>
    stripTypeScriptTypes(fs.readFileSync(path.join(runtimeSrc, file), "utf8")).replace(
      /from "\.\/(\w+)\.ts"/g,
      'from "./$1.js"',
    );
  fs.writeFileSync(path.join(webRoot, "protocol.js"), strip("protocol.ts"));
  fs.writeFileSync(path.join(webRoot, "host.js"), strip("host.ts"));
  fs.writeFileSync(
    path.join(webRoot, "index.html"),
    `<!doctype html><title>Sandbox test host</title><script type="module">import { mountTool } from "./host.js"; window.mountTool = mountTool;</script>`,
  );
  server = await startLocalServer({ port: 0, webRoot, routes: runtimeRoutes((id) => tools[id]) });
});
test.afterAll(async () => {
  await server.close();
  probe.close();
  fs.rmSync(webRoot, { recursive: true, force: true });
});

test("mounts a tool behind the wrapper and talks to it only through the bridge (RUN-01)", async ({
  page,
}) => {
  await page.goto(`${server.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  const exchange = await page.evaluate(async () => {
    type Mount = (
      container: HTMLElement,
      mountId: string,
    ) => Promise<{
      send(message: unknown): void;
      onMessage(listen: (message: unknown) => void): () => void;
    }>;
    const tool = await (window as unknown as { mountTool: Mount }).mountTool(document.body, "echo");
    const received: unknown[] = [];
    await new Promise<void>((resolve) => {
      tool.onMessage((message) => {
        received.push(message);
        if (received.length === 1) tool.send("ping");
        if (received.length === 2) resolve();
      });
    });
    return received;
  });
  // The tool's origin is opaque, and the message went there and back over the bridge.
  expect(exchange).toEqual([{ origin: "null" }, { echo: "ping" }]);

  // The wrapper is on the opposite loopback name; the tool is sandboxed inside it.
  const wrapper = page.frames().find((f) => f.url().includes("/runtime/wrapper"));
  expect(new URL(wrapper?.url() ?? "about:blank").hostname).toBe("localhost");
  const sandbox = await wrapper?.locator("iframe").getAttribute("sandbox");
  expect(sandbox).toBe("allow-scripts");
});

type Leave = { by: "assigning" | "reloading" | "link" | "refresh"; to?: string };
type Outcome = { messages: unknown[]; events: string[]; frameText: string | undefined };

// Mounts the wanderer, asks it to count, to leave its page, then to count again.
async function leavePage(page: Page, leave: Leave): Promise<Outcome> {
  await page.goto(`${server.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  const { messages, events } = await page.evaluate(async (leave) => {
    type Mount = (
      container: HTMLElement,
      mountId: string,
    ) => Promise<{
      send(message: unknown): void;
      onMessage(listen: (message: unknown) => void): () => void;
      onEvent(listen: (event: string) => void): () => void;
    }>;
    const mount = (window as unknown as { mountTool: Mount }).mountTool;
    const tool = await mount(document.body, "wanderer");
    const messages: unknown[] = [];
    const events: string[] = [];
    tool.onMessage((message) => messages.push(message));
    tool.onEvent((event) => events.push(event));
    const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const said = async (count: number) => {
      for (let i = 0; i < 100 && messages.length < count; i += 1) await settle(50);
    };
    await said(1);
    tool.send("count");
    await said(2);
    tool.send(leave);
    await settle(1500);
    tool.send("count");
    await said(4);
    return { messages, events };
  }, leave);
  const wrapper = page.frames().find((f) => f.url().includes("/runtime/wrapper"));
  const frameText = await wrapper?.locator("iframe").contentFrame().locator("body").innerText();
  return { messages, events, frameText };
}

test("keeps a tool on its page when it navigates its own frame (SBX-07)", async ({ page }) => {
  test.setTimeout(60_000);
  const leaves: Leave[] = [
    { by: "assigning", to: "/runtime/tool?mount=echo&leak=private" },
    { by: "link", to: "/runtime/tool?mount=wanderer" },
    { by: "reloading" },
    { by: "refresh", to: "/runtime/tool?mount=wanderer" },
  ];
  probeHits = 0;
  for (const leave of leaves) {
    const { messages, events, frameText } = await leavePage(page, leave);
    // The same run of the tool answers before and after: its page and its memory stayed.
    const run = (messages[0] as { run: string }).run;
    expect(messages, leave.by).toEqual([{ run }, { run, count: 1 }, { run, count: 2 }]);
    expect(events, leave.by).toEqual([]);
    expect(frameText, leave.by).toMatch(/^Wanderer/);
  }
  expect(probeHits).toBe(0);
});

test("starts a tool again when it leaves for a page it may not load (SBX-07)", async ({ page }) => {
  test.setTimeout(60_000);
  const outside = `http://127.0.0.1:${(probe.address() as AddressInfo).port}/`;
  const leaves: Leave[] = [
    { by: "assigning", to: "about:blank" },
    { by: "assigning", to: outside },
    { by: "link", to: outside },
    { by: "assigning", to: "/runtime/wrapper" },
  ];
  probeHits = 0;
  for (const leave of leaves) {
    const { messages, events, frameText } = await leavePage(page, leave);
    // A fresh run of the tool, on a fresh port; the old page never got one.
    const [first, , again] = messages as { run: string }[];
    expect(again?.run, leave.to).not.toBe(first?.run);
    expect(messages.slice(2), leave.to).toEqual([
      { run: again?.run },
      { run: again?.run, count: 1 },
    ]);
    expect(events, leave.to).toEqual(["restarted"]);
    expect(frameText, leave.to).toBe("Wanderer");
  }
  expect(probeHits).toBe(0);
});

test("stops a tool that keeps leaving its page (SBX-07)", async ({ page }) => {
  await page.goto(`${server.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  const events = await page.evaluate(async () => {
    type Mount = (
      container: HTMLElement,
      mountId: string,
    ) => Promise<{ onEvent(listen: (event: string) => void): () => void }>;
    const tool = await (window as unknown as { mountTool: Mount }).mountTool(
      document.body,
      "runaway",
    );
    const events: string[] = [];
    return new Promise<string[]>((resolve) =>
      tool.onEvent((event) => {
        events.push(event);
        if (event === "stopped") resolve(events);
      }),
    );
  });
  expect(events).toEqual(["restarted", "restarted", "restarted", "stopped"]);
  const wrapper = page.frames().find((f) => f.url().includes("/runtime/wrapper"));
  await expect(wrapper!.locator("iframe")).toHaveCount(0);
});
