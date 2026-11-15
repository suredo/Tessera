import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// A tool that tries to reach the file system (CAP-03, A80, RUN-01), end to end in Chrome (TEST-06):
// hand-written, so no static check stops it first, it tries every way it has. Reading a file by
// address, the browser's file pickers, a download link and a new window all fail inside the
// sandbox. Its own file input still opens the browser's picker, as the threat model says: the tool
// gets only the bytes of the file the person chose, never a path or a folder.

const prober: Artifact["code"] = {
  html: `<button id="probe" type="button">Probe</button>
<input id="own" type="file">
<a id="save" href="data:text/plain,hello" download="hello.txt">Save</a>`,
  css: "",
  js: `const tries = {};
const attempt = async (name, run) => {
  try { tries[name] = "reached: " + String(await run()).slice(0, 40); }
  catch (e) { tries[name] = "refused"; }
};
document.getElementById("probe").addEventListener("click", async () => {
  await attempt("fetch", () => fetch("file:///C:/Windows/win.ini").then((r) => r.status));
  await attempt("xhr", () => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.onload = () => resolve(x.status);
    x.onerror = () => reject(new Error("no"));
    x.open("GET", "file:///etc/passwd");
    x.send();
  }));
  await attempt("image", () => new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve("loaded");
    i.onerror = () => reject(new Error("no"));
    i.src = "file:///C:/Windows/Web/Wallpaper/Windows/img0.jpg";
  }));
  for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) {
    await attempt(name, () => Promise.race([
      window[name](),
      new Promise((resolve) => setTimeout(() => resolve("a picker opened"), 3000)),
    ]));
  }
  tries.window = window.open("file:///C:/") === null ? "refused" : "opened";
  document.getElementById("save").click();
  tessera.send({ tries });
});
document.getElementById("own").addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files[0];
  tessera.send({ own: { value: input.value, name: file.name, keys: Object.keys(file), path: "path" in file, relative: file.webkitRelativePath } });
});`,
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ prober });
});
test.afterAll(() => host.close());

type Seen = {
  tries?: Record<string, string>;
  own?: { value: string; name: string; keys: string[]; path: boolean; relative: string };
};
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<unknown>;
  tool: { onMessage(listen: (m: unknown) => void): void };
  messages: Seen[];
};

async function open(page: Page) {
  await page.goto(`${host.url}/`);
  await ready(page, "mountTool");
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    w.messages = [];
    w.tool = (await w.mountTool(document.body, "prober")) as TestWindow["tool"];
    w.tool.onMessage((m) => w.messages.push(m as Seen));
  });
  await expect(toolFrame(page).locator("#probe")).toBeVisible();
}
const messages = (page: Page) =>
  page.evaluate(() => [...(window as unknown as TestWindow).messages]);

test("FIL-05, CAP-03, RUN-01: a tool can't read a file by its address, use the browser's file pickers, download or open a window", async ({
  page,
}) => {
  await open(page);
  let downloads = 0;
  let popups = 0;
  page.on("download", () => (downloads += 1));
  page.on("popup", () => (popups += 1));
  await toolFrame(page).locator("#probe").click();
  await expect
    .poll(async () => (await messages(page)).find((m) => m.tries)?.tries)
    .toEqual({
      fetch: "refused",
      xhr: "refused",
      image: "refused",
      showOpenFilePicker: "refused",
      showSaveFilePicker: "refused",
      showDirectoryPicker: "refused",
      window: "refused",
    });
  expect(downloads).toBe(0);
  expect(popups).toBe(0);
});

test("FIL-03, CAP-03, A80: a tool's own file input gets only the file the person chose, never its path", async ({
  page,
}) => {
  await open(page);
  const chooser = page.waitForEvent("filechooser");
  await toolFrame(page).locator("#own").click();
  await (
    await chooser
  ).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect
    .poll(async () => (await messages(page)).find((m) => m.own)?.own)
    .toEqual({
      value: "C:\\fakepath\\notes.txt",
      name: "notes.txt",
      keys: [],
      path: false,
      relative: "",
    });
});
