import { expect, test, type Page } from "@playwright/test";
import type { Intent } from "@tessera/contracts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import {
  listWorkspaces,
  patchWorkspaceData,
  readWorkspaceData,
} from "../../server/src/workspaces/index.ts";
import { editFixture } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// Answering proposed entry changes in words (L-98, DATA-02, TEST-03): while a review waits, a
// reply that approves it applies it as Apply does, one that declines it dismisses it, and anything
// else is a new request. The model's answers are scripted; nothing reaches a model (ENG-11).

// One shared scenario; a failed step must not restart later steps from creation.
test.describe.configure({ mode: "serial" });

const intent = (kind: Intent["kind"]): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    language: "en",
    features: [],
    targetsCurrentTool: true,
    behaviorChange: false,
    lookOnly: false,
  }) as Intent;
const patch = (operation: unknown) => ({
  outcome: "patch",
  summary: "Prepared the entry change.",
  patch: { operations: [operation] },
});
// A change to an existing entry from a stale count always waits for review.
const rename = (id: string, title: string) =>
  patch({ op: "replace", collection: "items", id, revisionCount: 999, fields: { title } });
const steps = [
  { stage: "intent", value: intent("create") },
  { stage: "create", value: editFixture },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: rename("i-1", "Oat milk") },
  { stage: "intent", value: intent("approve_proposal") },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: rename("i-2", "Duck eggs") },
  { stage: "intent", value: intent("decline_proposal") },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: rename("i-2", "Duck eggs") },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: patch({ op: "add", collection: "items", record: { title: "Bread" } }) },
  { stage: "intent", value: intent("data") },
  { stage: "data", value: rename("i-1", "Milk") },
  { stage: "intent", value: intent("approve_proposal") },
];
const prompts: string[] = [];
const provider: Provider = {
  name: "scripted:review-reply",
  live: false,
  run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`Unexpected ${spec.stage}`);
    if (spec.stage === "intent") prompts.push(spec.prompt);
    return Promise.resolve({
      value: spec.schema.parse(step.value),
      raw: JSON.stringify(step.value),
      usage: UNKNOWN_USAGE,
    });
  },
};
let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());
const frame = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");
const workspace = () => listWorkspaces(app.folder)[0]!;
const review = (page: Page) => page.getByRole("region", { name: en["request.dataReview"] });
const WAITING = "--- waiting changes ---";
async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(text);
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeEnabled({
    timeout: 30_000,
  });
}

test("GEN-05: create the list whose entries are reviewed", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "A shopping list with milk and eggs");
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
});

test("L-98 DATA-02: a reply that approves the waiting changes applies them, as Apply does", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Rename Milk to Oat milk");
  await expect(review(page)).toContainText("Oat milk");
  // Nothing waited when the rename was asked, so its intent was told of none.
  expect(prompts.at(-1)).not.toContain(WAITING);
  await ask(page, "I approve");
  expect(prompts.at(-1)).toContain(WAITING);
  expect(prompts.at(-1)).toContain("Prepared the entry change.");
  await expect(newestReply(page)).toContainText(
    "Changed one entry in Shopping list. Prepared the entry change.",
  );
  await expect(review(page)).toHaveCount(0);
  await expect(frame(page).getByRole("listitem")).toHaveText(["Oat milk", "Eggs"]);
});

test("L-98 DATA-02: a reply that declines them dismisses them, and nothing is written", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Rename Eggs to Duck eggs");
  await expect(review(page)).toContainText("Duck eggs");
  const before = workspace();
  await ask(page, "No, leave it");
  await expect(newestReply(page)).toContainText(en["request.dataCancelled"]);
  await expect(review(page)).toHaveCount(0);
  expect(workspace()).toEqual(before);
});

test("L-98: anything else while they wait is a new request", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "Rename Eggs to Duck eggs");
  await expect(review(page)).toContainText("Duck eggs");
  await ask(page, "Add Bread");
  expect(prompts.at(-1)).toContain(WAITING);
  await expect(newestReply(page)).toContainText(
    "Changed one entry in Shopping list. Prepared the entry change.",
  );
  await expect(review(page)).toHaveCount(0);
  await expect(frame(page).getByRole("listitem")).toHaveText(["Oat milk", "Eggs", "Bread"]);
});

test("L-98 DATA-02: an approval in words keeps the review's revision guard", async ({ page }) => {
  await page.goto(app.url);
  await ask(page, "Rename Oat milk back to Milk");
  await expect(review(page)).toContainText("Milk");
  const current = workspace();
  const count = readWorkspaceData(app.folder, current.id).revisions["items"]!["i-1"]!;
  expect(
    patchWorkspaceData(app.folder, current.id, {
      operations: [
        {
          op: "replace",
          collection: "items",
          id: "i-1",
          revisionCount: count,
          fields: { title: "Soy milk" },
        },
      ],
    }).ok,
  ).toBe(true);
  const before = workspace();
  await ask(page, "yes");
  await expect(newestReply(page)).toContainText(en["request.dataStale"]);
  expect(workspace()).toEqual(before);
  expect(steps).toHaveLength(0);
});
