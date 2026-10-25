import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { storeAsset } from "../../server/src/assets/index.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  saveWorkspaceData,
} from "../../server/src/workspaces/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";

// Images in a tool (DATA-11, AST-04, AST-05), end to end in Chrome and Edge (TEST-06): a
// hand-written tool shows an image its saved data names, through a blob: URL under its strict CSP
// (RUN-01), with the bytes from the server's asset store over the bridge; it never sees a path,
// and an image another workspace names is refused. The data folder is a temporary one (ENG-19).

const gallery: Artifact["code"] = {
  html: '<img id="photo" alt="The cover photo">',
  css: "img { display: block; }",
  js: `const photo = document.getElementById("photo");
const show = async (id) => {
  try {
    const url = await tessera.assetUrl(id);
    photo.onload = () => tessera.send({ shown: { url, width: photo.naturalWidth, height: photo.naturalHeight } });
    photo.onerror = () => tessera.send({ shown: { url, failed: true } });
    photo.src = url;
  } catch (e) { tessera.send({ refused: { code: e.code, message: e.message } }); }
};
tessera.call("data.read").then(({ data }) => show(data.cover));
tessera.onMessage((id) => show(id));`,
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
const bytesOf = (name: string) => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ gallery }, { data: true });
});
test.afterAll(() => host.close());

/** A workspace running the gallery, whose data names `image` as its cover. */
async function workspaceShowing(image: string) {
  const folder = host.folder!;
  const stored = await storeAsset(folder, bytesOf(image));
  if (!stored.ok) throw new Error(stored.message);
  const { id } = createWorkspace(folder, "Gallery");
  const version = saveVersion(folder.db, {
    contractVersion: 2,
    code: gallery,
    data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
    capabilities: [],
    pins: [],
    ui: { standardVersion: 1, mode: "standard" },
  });
  addWorkspaceVersion(folder, id, version);
  saveWorkspaceData(folder, id, { cover: stored.asset.id }, 0);
  return { workspaceId: id, assetId: stored.asset.id };
}

type Seen = { shown?: { url: string; width?: number; height?: number; failed?: boolean } };
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<unknown>;
  serveBridge(tool: unknown, options: unknown): unknown;
  serverData(workspaceId: string): unknown;
  tool: { send(message: unknown): void; onMessage(listen: (m: unknown) => void): void };
  messages: (Seen & { refused?: { code: string; message: string } })[];
};

async function open(page: Page, workspaceId: string) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "serverData" in window);
  host.reset();
  await page.evaluate(async (workspaceId) => {
    const w = window as unknown as TestWindow;
    w.messages = [];
    w.tool = (await w.mountTool(document.body, "gallery")) as TestWindow["tool"];
    w.tool.onMessage((m) => w.messages.push(m as TestWindow["messages"][number]));
    w.serveBridge(w.tool, { capabilities: [], data: w.serverData(workspaceId) });
  }, workspaceId);
}
const messages = (page: Page) =>
  page.evaluate(() => [...(window as unknown as TestWindow).messages]);

test("DATA-11: a tool shows an image its data names, through a blob: URL under its CSP", async ({
  page,
}) => {
  const { workspaceId } = await workspaceShowing("photo.png");
  await open(page, workspaceId);
  await expect
    .poll(async () => (await messages(page)).find((m) => m.shown)?.shown)
    .toMatchObject({ width: 4, height: 3 });
  const shown = (await messages(page)).find((m) => m.shown)!.shown!;
  // A blob: URL of the tool's own, opaque origin: never a path or an address of the host.
  expect(shown.url).toMatch(/^blob:null\//);
  await expect(toolFrame(page).locator("#photo")).toBeVisible();
  // The bytes came over the bridge: no request reached the host for the image itself.
  expect(
    host.hostRequests.filter((r) => !r.includes("/api/bridge") && !r.includes("/runtime/")),
  ).toEqual([]);
});

test("AST-04: a tool can't show an image only another workspace names, even by its ID", async ({
  page,
}) => {
  const { workspaceId } = await workspaceShowing("photo.png");
  const other = await workspaceShowing("photo.jpg");
  await open(page, workspaceId);
  await expect.poll(async () => (await messages(page)).some((m) => m.shown)).toBe(true);
  await page.evaluate((id) => (window as unknown as TestWindow).tool.send(id), other.assetId);
  await expect
    .poll(async () => (await messages(page)).find((m) => m.refused)?.refused)
    .toEqual({ code: "invalid-args", message: "That image isn't one this tool's data names." });
});
