import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import {
  addWorkspaceVersion,
  createWorkspace,
  patchWorkspaceData,
  readWorkspaceData,
  saveWorkspaceData,
} from "../../server/src/workspaces/index.ts";
import { startSandboxHost, toolFrame, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The bridge to saved data, end to end (RUN-04, BRG-04, DATA-02), in Chrome and Edge (TEST-06): a
// tool in the sandbox reads its workspace's data through the host page's serveBridge and
// serverData, and the server's bridge route answers from a temporary data folder. A change planned
// against a record that was edited since is refused whole; one to another record is saved.

const errands: Artifact["code"] = {
  html: '<button id="one">Finish the first</button><button id="two">Finish the second</button>',
  css: "button { width: 150px; height: 60px; }",
  js: `let revisions;
tessera.call("data.read").then((read) => { revisions = read.revisions; tessera.send({ read }); });
const change = async (label, operations) => {
  try { tessera.send({ label, ok: true, result: await tessera.call("data.patch", { operations }) }); }
  catch (e) { tessera.send({ label, ok: false, code: e.code, message: e.message }); }
};
const done = (id) => ({ op: "replace", collection: "tasks", id, revisionCount: revisions.tasks[id], fields: { done: true } });
document.getElementById("one").addEventListener("click", () => change("one", [
  { op: "add", collection: "tasks", record: { title: "Should not appear", done: false } },
  done("t-1"),
]));
document.getElementById("two").addEventListener("click", () => change("two", [done("t-2")]));`,
};
const tasks = {
  tasks: [
    { id: "t-1", title: "Buy milk", done: false },
    { id: "t-2", title: "Call the bank", done: false },
  ],
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ errands }, { data: true });
});
test.afterAll(() => host.close());

type Reply = { label?: string; ok?: boolean; code?: string; message?: string; read?: unknown };
type TestWindow = {
  mountTool(container: HTMLElement, mountId: string): Promise<unknown>;
  serveBridge(tool: unknown, options: unknown): unknown;
  serverData(workspaceId: string): unknown;
  messages: Reply[];
};

/** A workspace running the errands tool, with two tasks saved. */
function newWorkspace(): string {
  const folder = host.folder!;
  const { id } = createWorkspace(folder, "Errands");
  const version = saveVersion(folder.db, {
    contractVersion: 2,
    code: errands,
    data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
    capabilities: [],
    pins: [],
    ui: { standardVersion: 1, mode: "standard" },
  });
  addWorkspaceVersion(folder, id, version);
  saveWorkspaceData(folder, id, tasks, 0);
  return id;
}

/** Mounts the tool and serves it the bridge, answered by the server for `workspaceId`. */
async function open(page: Page, workspaceId: string) {
  await page.goto(`${host.url}/`);
  await ready(page, "serverData");
  await page.evaluate(async (workspaceId) => {
    const w = window as unknown as TestWindow;
    w.messages = [];
    const tool = (await w.mountTool(document.body, "errands")) as {
      onMessage(listen: (m: unknown) => void): void;
    };
    tool.onMessage((m) => w.messages.push(m as Reply));
    w.serveBridge(tool, { capabilities: [], data: w.serverData(workspaceId) });
  }, workspaceId);
}

const messages = (page: Page) =>
  page.evaluate(() => [...(window as unknown as TestWindow).messages]);
const labelled = async (page: Page, label: string) =>
  (await messages(page)).find((m) => m?.label === label);

test("the tool reads its saved data through the server, with each record's revision (RUN-04)", async ({
  page,
}) => {
  const id = newWorkspace();
  await open(page, id);
  await expect
    .poll(async () => (await messages(page)).find((m) => m?.read)?.read)
    .toEqual({ data: tasks, revisions: { tasks: { "t-1": 1, "t-2": 1 } } });
});

test("BRG-04: a change planned before another edit to its record is refused whole; one to another record is saved", async ({
  page,
}) => {
  const id = newWorkspace();
  await open(page, id);
  await expect.poll(async () => (await messages(page)).some((m) => m?.read)).toBe(true);

  // After the tool read its data, t-1 is changed elsewhere, as chat or another window would.
  const elsewhere = patchWorkspaceData(host.folder!, id, {
    operations: [
      {
        op: "replace",
        collection: "tasks",
        id: "t-1",
        revisionCount: 1,
        fields: { title: "Buy oat milk" },
      },
    ],
  });
  expect(elsewhere.ok).toBe(true);

  await toolFrame(page).locator("#one").click();
  await expect.poll(() => labelled(page, "one")).toMatchObject({ ok: false, code: "stale" });
  expect((await labelled(page, "one"))?.message).toMatch(
    /^Nothing was changed: .*newer edit is kept/,
  );
  // Nothing of the refused change was saved: not its add, not its edit; the newer edit is kept.
  expect(readWorkspaceData(host.folder!, id).data).toEqual({
    tasks: [
      { id: "t-1", title: "Buy oat milk", done: false },
      { id: "t-2", title: "Call the bank", done: false },
    ],
  });

  await toolFrame(page).locator("#two").click();
  await expect.poll(() => labelled(page, "two")).toMatchObject({ ok: true });
  expect(readWorkspaceData(host.folder!, id)).toEqual({
    data: {
      tasks: [
        { id: "t-1", title: "Buy oat milk", done: false },
        { id: "t-2", title: "Call the bank", done: true },
      ],
    },
    revisions: { tasks: { "t-1": 2, "t-2": 2 } },
  });
});
