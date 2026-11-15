import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { workspaceAssets } from "../../server/src/assets/index.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import { addWorkspaceVersion, createWorkspace } from "../../server/src/workspaces/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// Files in (CAP-03, A80), end to end in Chrome (TEST-06): a hand-written tool asks for an image
// from a click; the host page shows the browser's own picker, the server keeps what the person
// picked as an asset held for the workspace, and the tool shows it through a blob: URL, never
// seeing a path. Without a click no picker opens. The data folder is a temporary one (ENG-19).

const picker: Artifact["code"] = {
  html: '<button id="pick" type="button">Open a photo</button><img id="photo" alt="The photo">',
  css: "img { display: block; }",
  js: `const photo = document.getElementById("photo");
const pick = () => tessera.pickFile().then(async (file) => {
  tessera.send({ picked: file });
  if (!file) return;
  photo.onload = () => tessera.send({ shown: { width: photo.naturalWidth, height: photo.naturalHeight } });
  photo.src = await tessera.assetUrl(file.id);
}, (e) => tessera.send({ refused: { code: e.code, message: e.message } }));
document.getElementById("pick").addEventListener("click", pick);`,
};

// A tool that asks on its own, with no click: after 6 seconds, once the activation a test's own
// page.evaluate gives the page has lapsed (#371).
const eager: Artifact["code"] = {
  html: "<p>Waiting</p>",
  css: "",
  js: `setTimeout(() => tessera.pickFile().then(
  (file) => tessera.send({ picked: file }),
  (e) => tessera.send({ refused: { code: e.code, message: e.message } }),
), 6000);`,
};

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "server",
  "test",
  "fixtures",
  "assets",
);
const photo = fs.readFileSync(path.join(fixtures, "photo.png"));

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ picker, eager }, { data: true });
});
test.afterAll(() => host.close());

/** A workspace running `code`, which declares files. */
function workspace(code = picker): string {
  const folder = host.folder!;
  const { id } = createWorkspace(folder, "Photos");
  const version = saveVersion(folder.db, {
    contractVersion: 4,
    connections: {},
    code,
    data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
    capabilities: ["files"],
    pins: [],
    ui: { standardVersion: 1, mode: "standard" },
  });
  addWorkspaceVersion(folder, id, version);
  return id;
}

type Seen = {
  picked?: { id: string; name: string; widthPx: number } | null;
  shown?: { width: number; height: number };
  refused?: { code: string; message: string };
};
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<unknown>;
  serveBridge(tool: unknown, options: unknown): unknown;
  serverData(workspaceId: string): unknown;
  tool: { send(message: unknown): void; onMessage(listen: (m: unknown) => void): void };
  messages: Seen[];
};

async function open(page: Page, workspaceId: string, mountId = "picker") {
  await page.goto(`${host.url}/`);
  await ready(page, "serverData");
  host.reset();
  await page.evaluate(
    async ({ workspaceId, mountId }) => {
      const w = window as unknown as TestWindow;
      w.messages = [];
      w.tool = (await w.mountTool(document.body, mountId)) as TestWindow["tool"];
      w.tool.onMessage((m) => w.messages.push(m as Seen));
      w.serveBridge(w.tool, { capabilities: ["files"], data: w.serverData(workspaceId) });
    },
    { workspaceId, mountId },
  );
}
const messages = (page: Page) =>
  page.evaluate(() => [...(window as unknown as TestWindow).messages]);
/** The images a workspace's tool may read: here, only those picked for it. */
const held = (workspaceId: string) => [...workspaceAssets(host.folder!, workspaceId)];

test("FIL-03, CAP-03, DATA-11: after a click the host's picker opens, and the tool shows the image it picked, never a path", async ({
  page,
}) => {
  const workspaceId = workspace();
  await open(page, workspaceId);
  await expect(toolFrame(page).locator("#pick")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await toolFrame(page).locator("#pick").click();
  const shown = await chooser;
  // The host page's own picker, for images only.
  expect(await shown.element().evaluate(() => window === window.top)).toBe(true);
  expect(await shown.element().getAttribute("accept")).toBe("image/png,image/jpeg,image/webp");
  await shown.setFiles({ name: "beach.png", mimeType: "image/png", buffer: photo });

  await expect
    .poll(async () => (await messages(page)).find((m) => m.shown)?.shown)
    .toEqual({ width: 4, height: 3 });
  const picked = (await messages(page)).find((m) => m.picked)!.picked!;
  expect(picked).toMatchObject({ name: "beach.png", type: "image/png", widthPx: 4, heightPx: 3 });
  // Only what it is, never where it was.
  expect(Object.keys(picked).sort()).toEqual([
    "heightPx",
    "id",
    "name",
    "sizeBytes",
    "type",
    "widthPx",
  ]);
  // Kept as an asset, and held for this workspace.
  expect(held(workspaceId)).toEqual([picked.id]);
});

test("FIL-02, AST-01: a file that isn't an image, whatever its name, is refused plainly and nothing is kept", async ({
  page,
}) => {
  const workspaceId = workspace();
  await open(page, workspaceId);
  await expect(toolFrame(page).locator("#pick")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await toolFrame(page).locator("#pick").click();
  await (
    await chooser
  ).setFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await expect
    .poll(async () => (await messages(page)).find((m) => m.refused)?.refused)
    .toEqual({
      code: "invalid-args",
      message: "Nothing was saved: the file isn't a PNG, JPEG or WebP image, whatever its name.",
    });
  expect(held(workspaceId)).toEqual([]);
});

test("FIL-01, A80: without the person's click no picker opens, and the tool hears why", async ({
  page,
}) => {
  test.setTimeout(30_000);
  let opened = false;
  page.on("filechooser", () => (opened = true));
  await open(page, workspace(eager), "eager");
  // Nothing touches the page until the tool has asked and been answered.
  await page.waitForTimeout(8_000);
  const seen = await messages(page);
  expect(seen.find((m) => m.refused)?.refused).toEqual({
    code: "not-allowed",
    message:
      "A file is picked only right after the person clicks for it. Nothing was opened. Ask for files only from a click handler.",
  });
  expect(opened).toBe(false);
});
