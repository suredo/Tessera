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
// What a nested document tries (SBX-06): each attempt should fail, as it does in the tool itself.
const NESTED_CHECKS = `(async () => {
  const probe = PROBE;
  const result = { origin: self.origin, tessera: typeof tessera, violations: [] };
  addEventListener("securitypolicyviolation", (e) => result.violations.push(e.effectiveDirective));
  const attempt = (f) => { try { f(); return "allowed"; } catch { return "blocked"; } };
  result.fetch = await fetch(probe + "fetch").then(() => "loaded", () => "blocked");
  result.image = await new Promise((done) => {
    const image = new Image();
    image.onload = () => done("loaded");
    image.onerror = () => done("blocked");
    image.src = probe + "image";
  });
  result.localStorage = attempt(() => localStorage.length);
  result.cookie = attempt(() => document.cookie);
  result.indexedDB = attempt(() => indexedDB.open("nested"));
  result.popup = attempt(() => { if (!open(probe + "popup")) throw new Error("no window"); });
  result.hostPage = attempt(() => top.document.title);
  attempt(() => { top.location.href = probe + "top"; });
  const inner = document.createElement("iframe");
  inner.src = probe + "inner";
  document.body.append(inner);
  // A bridge hello to the wrapper, from a frame that isn't the tool's.
  parent.parent.postMessage({ type: "tessera:hello" }, "*");
  await new Promise((done) => setTimeout(done, 500));
  parent.postMessage({ nested: result }, "*");
})();`;
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
  // Opens a nested srcdoc or javascript: frame, whose script the browser runs (SBX-06), runs the
  // checks below in it and passes on what they found.
  nester: {
    html: "<p>Nester</p>",
    css: "",
    js: `const NESTED_CHECKS = ${JSON.stringify(NESTED_CHECKS)};
tessera.onMessage(({ probe, how }) => {
  const frame = document.createElement("iframe");
  addEventListener("message", (e) => {
    if (e.source === frame.contentWindow && e.data && e.data.nested) tessera.send(e.data.nested);
  });
  const page = "<script>" + NESTED_CHECKS.replace("PROBE", JSON.stringify(probe)) + "</script>";
  if (how === "srcdoc") frame.srcdoc = page;
  else frame.src = "javascript:" + JSON.stringify(page);
  document.body.append(frame);
});`,
  },
  // Tries the nested documents that must not load at all (SBX-06), and says which did.
  loader: {
    html: "<p>Loader</p>",
    css: "",
    js: `tessera.onMessage(({ probe }) => {
  const loaded = [];
  addEventListener("message", (e) => { if (e.data && e.data.loaded) loaded.push(e.data.loaded); });
  const say = (what) => "<script>parent.postMessage({ loaded: '" + what + "' }, '*')</script>";
  const blob = URL.createObjectURL(new Blob([say("blob")], { type: "text/html" }));
  const add = (tag, attribute, url) => { const el = document.createElement(tag); el.setAttribute(attribute, url); document.body.append(el); };
  add("iframe", "src", probe + "iframe");
  add("iframe", "src", "data:text/html," + encodeURIComponent(say("data")));
  add("iframe", "src", blob);
  add("iframe", "src", "/runtime/tool?mount=echo");
  add("frame", "src", probe + "frame");
  add("object", "data", probe + "object");
  add("embed", "src", probe + "embed");
  // A blank frame loads, but it gets an opaque origin of its own: the tool can't write into it.
  const blank = document.createElement("iframe");
  document.body.append(blank);
  const blankScriptable = blank.contentDocument !== null;
  setTimeout(() => tessera.send({ loaded, blankScriptable }), 1500);
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

test("SBX-07: keeps a tool on its page when it navigates its own frame", async ({ page }) => {
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

test("SBX-07: starts a tool again when it leaves for a page it may not load", async ({ page }) => {
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

test("SBX-07: stops a tool that keeps leaving its page", async ({ page }) => {
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

type Asked = { messages: unknown[]; events: string[] };

// Mounts a tool, waits for it, sends it one message and collects what it says back.
async function ask(page: Page, mountId: string, message: unknown, replies: number): Promise<Asked> {
  await page.goto(`${server.url}/`);
  await page.waitForFunction(() => "mountTool" in window);
  return page.evaluate(
    async ({ mountId, message, replies }) => {
      type Mount = (
        container: HTMLElement,
        mountId: string,
      ) => Promise<{
        send(message: unknown): void;
        onMessage(listen: (message: unknown) => void): () => void;
        onEvent(listen: (event: string) => void): () => void;
      }>;
      const mount = (window as unknown as { mountTool: Mount }).mountTool;
      const tool = await mount(document.body, mountId);
      const messages: unknown[] = [];
      const events: string[] = [];
      tool.onMessage((m) => messages.push(m));
      tool.onEvent((event) => events.push(event));
      tool.send(message);
      for (let i = 0; i < 100 && messages.length < replies; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // Anything late, such as a restart, has time to show.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { messages, events };
    },
    { mountId, message, replies },
  );
}

const probeUrl = () => `http://127.0.0.1:${(probe.address() as AddressInfo).port}/`;

test("SBX-06: frames from URLs, data: and blob: frames, objects and embeds don't load", async ({
  page,
}) => {
  probeHits = 0;
  const { messages, events } = await ask(page, "loader", { probe: probeUrl() }, 1);
  expect(messages).toEqual([{ loaded: [], blankScriptable: false }]);
  expect(events).toEqual([]);
  expect(probeHits).toBe(0);
});

for (const how of ["srcdoc", "javascript:"]) {
  test(`SBX-06: a nested ${how} frame runs, but is as confined as the tool`, async ({ page }) => {
    probeHits = 0;
    const { messages, events } = await ask(page, "nester", { probe: probeUrl(), how }, 1);
    const [found] = messages as { violations: string[] }[];
    // It inherits the tool's sandbox (an opaque origin, no popups, no top navigation) and its CSP.
    expect(found).toMatchObject({
      origin: "null",
      tessera: "undefined",
      fetch: "blocked",
      image: "blocked",
      localStorage: "blocked",
      cookie: "blocked",
      indexedDB: "blocked",
      popup: "blocked",
      hostPage: "blocked",
    });
    expect(found?.violations).toEqual(
      expect.arrayContaining(["connect-src", "img-src", "frame-src"]),
    );
    // Its hello to the wrapper changed nothing, the host page stayed, and nothing got out.
    expect(events).toEqual([]);
    expect(page.url()).toBe(`${server.url}/`);
    expect(page.context().pages()).toHaveLength(1);
    expect(probeHits).toBe(0);
  });
}
