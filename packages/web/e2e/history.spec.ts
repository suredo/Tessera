import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { saveVersion } from "../../server/src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  patchWorkspaceData,
  readWorkspaceData,
} from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost } from "./support/app-host.ts";

// The open workspace's history (APP-05): restoring a version, with its plan confirmed first
// (DATA-10), undoing the last data change (DATA-04), and bringing back the copy kept before a
// restore that lost data. In Chrome and Edge at 320 and 1280 px (TEST-06), against a real
// Tessera on a temporary data folder (ENG-19).

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(() => app.close());

const listOf = (item: object) =>
  ({
    type: "object",
    properties: { tasks: { type: "array", items: item } },
  }) as Artifact["data"]["schema"];
const task = (properties: object) => ({
  type: "object",
  required: ["id", "title"],
  properties: { id: { type: "string" }, title: { type: "string" }, ...properties },
  additionalProperties: false,
});
/** A hand-written tool that shows `text`, with the data shape given. */
const tool = (text: string, data: Partial<Artifact["data"]> = {}): Artifact => ({
  contractVersion: 2,
  code: { html: `<p id="text">${text}</p>`, css: "", js: "" },
  data: {
    schemaVersion: 1,
    schema: listOf(task({})),
    defaults: { tasks: [{ id: "t-1", title: "Buy milk" }] },
    migrations: [],
    ...data,
  },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});

/** A workspace that ran each tool in turn; its name and ID. */
function workspaceThrough(...tools: Artifact[]) {
  const name = `Errands ${Math.random().toString(36).slice(2, 7)}`;
  const { id } = createWorkspace(app.folder, name);
  tools.forEach((artifact, revision) => {
    const result = activateVersion(app.folder, id, saveVersion(app.folder.db, artifact), revision);
    if (!result.ok) throw new Error(result.message);
  });
  return { name, id };
}
const tasksOf = (id: string) => readWorkspaceData(app.folder, id).data["tasks"];

const toolText = (page: Page) =>
  page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe")
    .locator("#text");
const history = (page: Page) => page.getByRole("region", { name: en["history.heading"] });
const versionRows = (page: Page) =>
  history(page)
    .getByRole("listitem")
    .filter({ hasText: /^Version \d/ });
async function openWorkspace(page: Page, name: string) {
  await page.goto(app.url);
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
}

test("APP-05: restoring a version that keeps the data asks first, and Cancel changes nothing", async ({
  page,
}) => {
  const { name } = workspaceThrough(tool("Tool A"), tool("Tool B"));
  await openWorkspace(page, name);
  await expect(toolText(page)).toHaveText("Tool B");
  await expect(versionRows(page)).toHaveCount(2);
  await expect(versionRows(page).first()).toContainText(en["history.current"]);

  await history(page).getByRole("button", { name: "Restore version 1" }).click();
  const confirm = page.getByRole("group", { name: "Restore version 1?" });
  await expect(confirm).toContainText(en["history.keepsData"]);
  await confirm.getByRole("button", { name: en["history.cancel"] }).click();
  await expect(confirm).toHaveCount(0);
  await expect(versionRows(page)).toHaveCount(2);
  await expect(toolText(page)).toHaveText("Tool B");

  await history(page).getByRole("button", { name: "Restore version 1" }).click();
  await confirm.getByRole("button", { name: en["history.confirm"], exact: true }).click();
  await expect(page.getByText("Version 1 is back, as the newest version.")).toBeVisible();
  await expect(toolText(page)).toHaveText("Tool A");
  // The restore is a new version, so the one before it stays restorable (DATA-04).
  await expect(versionRows(page)).toHaveCount(3);
  await expect(versionRows(page).first()).toContainText("Version 3");
});

test("APP-05, DATA-10: a restore that loses data names each value, and its copy brings them back", async ({
  page,
}) => {
  // Version 2 adds done and a note to each task; version 1 has room for neither.
  const v1 = tool("Version one");
  const v2 = tool("Version two", {
    schemaVersion: 2,
    schema: listOf(task({ done: { type: "boolean" }, note: { type: "string" } })),
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        operations: [{ op: "addField", collection: "tasks", fields: { done: false } }],
      },
    ],
  });
  const { name, id } = workspaceThrough(v1, v2);
  const noted = patchWorkspaceData(app.folder, id, {
    operations: [
      { op: "replace", collection: "tasks", id: "t-1", revisionCount: 2, fields: { note: "oat" } },
    ],
  });
  expect(noted.ok).toBe(true);
  await openWorkspace(page, name);
  await expect(toolText(page)).toHaveText("Version two");

  await history(page).getByRole("button", { name: "Restore version 1" }).click();
  const confirm = page.getByRole("group", { name: "Restore version 1?" });
  await expect(confirm.getByRole("listitem")).toHaveText([
    "tasks › t-1 › done: false",
    'tasks › t-1 › note: "oat"',
  ]);
  await confirm.getByRole("button", { name: en["history.confirmLoss"] }).click();
  await expect(toolText(page)).toHaveText("Version one");
  expect(tasksOf(id)).toEqual([{ id: "t-1", title: "Buy milk" }]);

  // The copy kept before the restore brings the note back, with the version that had room for it.
  await history(page)
    .getByRole("button", { name: /^Bring back the copy kept / })
    .click();
  await expect(toolText(page)).toHaveText("Version two");
  expect(tasksOf(id)).toEqual([{ id: "t-1", title: "Buy milk", done: false, note: "oat" }]);
});

test("DATA-04: Undo the last change brings the data back, one change at a time", async ({
  page,
}) => {
  const { name, id } = workspaceThrough(tool("Tool A"));
  patchWorkspaceData(app.folder, id, {
    operations: [{ op: "add", collection: "tasks", record: { id: "t-2", title: "Post a letter" } }],
  });
  await openWorkspace(page, name);
  const undo = history(page).getByRole("button", { name: en["history.undo"] });
  await expect(history(page)).toContainText("One record changed");
  await undo.click();
  await expect(page.getByText(en["history.undone"])).toBeVisible();
  await expect(history(page)).toContainText(en["history.nothingToUndo"]);
  expect(tasksOf(id)).toEqual([{ id: "t-1", title: "Buy milk" }]);
});

test("DATA-04: Undo never undoes a change the person hasn't seen", async ({ page }) => {
  const { name, id } = workspaceThrough(tool("Tool A"));
  patchWorkspaceData(app.folder, id, {
    operations: [{ op: "add", collection: "tasks", record: { id: "t-2", title: "Post a letter" } }],
  });
  await openWorkspace(page, name);
  await expect(history(page)).toContainText("One record changed");
  // The tool changes more while the history shows the earlier change.
  patchWorkspaceData(app.folder, id, {
    operations: [
      { op: "add", collection: "tasks", record: { id: "t-3", title: "Water the plants" } },
      { op: "add", collection: "tasks", record: { id: "t-4", title: "Call the bank" } },
    ],
  });
  await history(page).getByRole("button", { name: en["history.undo"] }).click();
  await expect(page.getByText(en["history.changedSince"])).toBeVisible();
  await expect(history(page)).toContainText("2 records changed");
  expect(tasksOf(id)).toHaveLength(4);
});
