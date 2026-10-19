import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
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
};

let server: LocalServer;
let webRoot: string;
test.beforeAll(async () => {
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
