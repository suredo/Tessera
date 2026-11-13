import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { addToChat } from "../../server/src/chat/index.ts";
import { findClaude, UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { editFixture } from "../../server/test/fixtures/edit-tool.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import {
  newestReply,
  startApp,
  testTool,
  workspaceWith,
  type AppHost,
} from "./support/app-host.ts";

// The chat (APP-01, APP-03, ADR 0011): each request and Tessera's reply show in the chat, said
// once; they are kept with the workspace the request made or acted on, so they are there after a
// reload, and each workspace shows its own. A turn on the empty screen, with no tool open, is kept
// in the empty screen's own chat (A62). Through the real pipeline with scripted answers
// (TEST-03, ENG-11), in Chrome at 1280 px (TEST-06), on a temporary data folder
// (ENG-19). The tests run in order, each taking the next answers from the script.

const intent = (kind: Intent["kind"]): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: false,
    language: "en",
    features: [],
  }) as Intent;

const notes: Creation = {
  outcome: "tool",
  name: "Notes",
  summary: "A page for notes.",
  code: { html: "<h1>Notes</h1>", css: "", js: "" },
  data: { schema: { type: "object" }, reusableDefaults: {}, initialState: {} },
  capabilities: [],
  uiMode: "standard",
};

const steps: { stage: string; value: unknown; delayMs?: number }[] = [
  // 1. Too vague, on the empty screen: nothing is made, and nowhere keeps the turn.
  { stage: "intent", value: intent("clarify") },
  // 2. A tool, made: its workspace keeps the turn.
  { stage: "intent", value: intent("create") },
  { stage: "create", value: notes },
  // 3. Too vague again, now with the tool open: its workspace keeps this turn too.
  { stage: "intent", value: intent("clarify") },
  // 4. Too vague, slowly, while the person opens another workspace.
  { stage: "intent", value: intent("clarify"), delayMs: 3000 },
  // 5. A shopping list, then a change to one of its entries, which waits for review.
  { stage: "intent", value: intent("create") },
  { stage: "create", value: editFixture },
  { stage: "intent", value: { ...intent("data"), targetsCurrentTool: true } },
  {
    stage: "data",
    value: {
      outcome: "patch",
      summary: "Prepared the entry change.",
      patch: {
        operations: [
          {
            op: "replace",
            collection: "items",
            id: "i-1",
            revisionCount: 999,
            fields: { title: "Oat milk" },
          },
        ],
      },
    },
  },
];
const provider: Provider = {
  name: "scripted:chat",
  live: false,
  run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) {
      return Promise.reject(new Error(`No ${spec.stage} answer is scripted next.`));
    }
    const answer = {
      value: spec.schema.parse(step.value),
      usage: UNKNOWN_USAGE,
      raw: JSON.stringify(step.value),
    };
    return new Promise((done) => setTimeout(() => done(answer), step.delayMs ?? 0));
  },
};

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());
test.describe.configure({ mode: "serial" });

const log = (page: Page) => page.getByRole("log", { name: en["chat.log"] });
const said = (page: Page) => log(page).locator(".chat-text");

/** Opens the workspace named `name` from the list, unless it is open already. */
async function openWorkspace(page: Page, name: string) {
  const open = page.getByRole("button", { name: `Open ${name}`, exact: true });
  const opened = page.getByRole("button", { name: `${name}, open`, exact: true });
  // The list loads after the page: wait for this workspace's row, whichever way it reads.
  await expect(open.or(opened)).toBeVisible();
  if (await open.count()) await open.click();
  await expect(page.getByRole("region", { name: `Tool: ${name}` })).toBeVisible();
}

async function ask(page: Page, request: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(request);
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(page.getByRole("button", { name: en["request.send"] })).toBeEnabled({
    timeout: 30_000,
  });
}

test("APP-01, GEN-08, A62: on the empty screen, a request and its reply show in the chat, said once, and are kept there", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Do the thing");
  await expect(said(page)).toHaveText(["Do the thing", en["request.clarify"]]);
  // Said once on the page: in the chat, not in a notice as well.
  await expect(page.getByText(en["request.clarify"])).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeVisible();
  await expect(said(page)).toHaveText(["Do the thing", en["request.clarify"]]);
});

test("APP-03: the workspace a request made keeps its turn, there after a reload", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "A page for my notes");
  const ready = "Notes is ready. A page for notes.";
  await expect(said(page)).toHaveText(["A page for my notes", ready]);
  await expect(page.getByText(ready)).toHaveCount(1);
  await page.reload();
  await expect(said(page)).toHaveText(["A page for my notes", ready]);
  expect(listWorkspaces(app.folder).map((w) => w.title)).toEqual(["Notes"]);
});

test("APP-03: each workspace shows its own chat, and a new turn joins the open one's", async ({
  page,
}) => {
  workspaceWith(app.folder, "Other", testTool("Other tool"));
  await page.goto(app.url);
  await openWorkspace(page, "Notes");
  await ask(page, "Make it nicer");
  await expect(said(page)).toHaveText([
    "A page for my notes",
    "Notes is ready. A page for notes.",
    "Make it nicer",
    en["request.clarify"],
  ]);
  await openWorkspace(page, "Other");
  await expect(said(page)).toHaveCount(0);
  await openWorkspace(page, "Notes");
  await expect(said(page)).toHaveCount(4);
  await page.screenshot({ path: test.info().outputPath("chat.png"), fullPage: true });
});

test("APP-01, GEN-08: a reply that comes while another workspace is open is said in the notice, and joins its own chat once", async ({
  page,
}) => {
  await page.goto(app.url);
  await openWorkspace(page, "Notes");
  await page.getByRole("textbox", { name: en["request.label"] }).fill("Something");
  await page.getByRole("button", { name: en["request.send"] }).click();
  await openWorkspace(page, "Other");
  // Other's chat is on screen, not Notes': the reply reaches the person in the notice.
  await expect(page.locator(".notice [role=status]").first()).toHaveText(en["request.clarify"], {
    timeout: 30_000,
  });
  await expect(said(page)).toHaveCount(0);
  await openWorkspace(page, "Notes");
  await expect(newestReply(page)).toHaveText(en["request.clarify"]);
  // Twice in Notes' chat, after "Make it nicer" and now; not in the notice as well.
  await expect(page.getByText(en["request.clarify"])).toHaveCount(2);
  // Read in its chat, it leaves the notice once the person moves on.
  await openWorkspace(page, "Other");
  await expect(page.getByText(en["request.clarify"])).toHaveCount(0);
});

test("APP-03: a review's outcome goes to the reviewed workspace's chat, whichever is open when the person chooses", async ({
  page,
}) => {
  await page.goto(app.url);
  await page.getByRole("textbox", { name: en["request.label"] }).fill("A shopping list");
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(newestReply(page)).toContainText("is ready", { timeout: 30_000 });
  await ask(page, "Rename Milk to Oat milk");
  const review = page.getByRole("region", { name: en["request.dataReview"] });
  await expect(review).toContainText("Oat milk");
  await openWorkspace(page, "Other");
  await review.getByRole("button", { name: en["request.reviewCancel"] }).click();
  await expect(page.locator(".notice [role=status]").first()).toHaveText(
    en["request.dataCancelled"],
  );
  await expect(said(page)).toHaveCount(0);
  const list = listWorkspaces(app.folder).find((w) => w.title === editFixture.name)!;
  await openWorkspace(page, list.title);
  await expect(newestReply(page)).toHaveText(en["request.dataCancelled"]);
});

test("APP-03, PLAT-03: a kept chat shows while setup fails, with no way to ask", async ({
  page,
}) => {
  const failing = await startApp({
    findClaude: () =>
      findClaude({ PATH: fs.mkdtempSync(path.join(os.tmpdir(), "no-cli-")) }, "win32"),
    probeProvider: () => {
      throw new Error("This test has no probe.");
    },
  });
  try {
    const id = workspaceWith(failing.folder, "Kept", testTool("Kept tool"));
    addToChat(failing.folder, id, [
      { from: "person", text: "A kept request" },
      { from: "tessera", text: "A kept reply." },
    ]);
    await page.goto(failing.url);
    await expect(said(page)).toHaveText(["A kept request", "A kept reply."]);
    await expect(page.getByRole("textbox", { name: en["request.label"] })).toHaveCount(0);
    // Expanding is the host's own control, so it works without the model too (APP-01).
    const tool = page.getByRole("region", { name: "Tool: Kept" });
    await tool.getByRole("button", { name: en["tool.expand"] }).click();
    await expect(page.getByRole("region", { name: en["chat.label"] })).toBeHidden();
    await tool.getByRole("button", { name: en["tool.leaveExpanded"] }).click();
    await expect(said(page)).toHaveText(["A kept request", "A kept reply."]);
  } finally {
    await failing.close();
  }
});
