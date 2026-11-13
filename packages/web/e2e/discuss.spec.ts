import { expect, test, type Page } from "@playwright/test";
import type { Intent } from "@tessera/contracts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces, readWorkspaceData } from "../../server/src/workspaces/index.ts";
import { editFixture } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// Discussing without building (GEN-19, A59, TEST-03): a question or an idea gets a plain answer in
// the chat, and nothing is built, changed or stored, with no tool open and with one. The request
// that follows it is built with the answer as context, once. The model's answers are scripted;
// nothing reaches a model (ENG-11).

// One shared scenario; a failed step must not restart later steps from creation.
test.describe.configure({ mode: "serial" });

const intent = (kind: Intent["kind"]): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    language: "en",
    features: [],
    targetsCurrentTool: kind !== "create",
    behaviorChange: false,
    lookOnly: false,
  }) as Intent;
const ABOUT_NONE =
  "A tool here can't send reminders while it's closed, but it can show what's due.";
const ABOUT_LIST =
  "A dialog would work: it opens as a panel inside the list, since a tool can't open its own windows.";
const steps = [
  { stage: "intent", value: intent("discuss") },
  { stage: "discuss", value: { answer: ABOUT_NONE } },
  { stage: "intent", value: intent("create") },
  { stage: "create", value: editFixture },
  { stage: "intent", value: intent("discuss") },
  { stage: "discuss", value: { answer: ABOUT_LIST } },
  { stage: "intent", value: intent("clarify") },
  { stage: "intent", value: intent("clarify") },
];
/** The conversation a prompt was told (A62), parsed back, or undefined if none. */
const told = (prompt: string) => {
  const quoted = /--- conversation ---\n(.*)\n--- end of the conversation ---/.exec(prompt)?.[1];
  return quoted === undefined
    ? undefined
    : (JSON.parse(quoted) as { earlier?: unknown[]; last: { from: string; text: string }[] });
};
const prompts: { stage: string; prompt: string }[] = [];
const provider: Provider = {
  name: "scripted:discuss",
  live: false,
  run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`Unexpected ${spec.stage}`);
    prompts.push({ stage: spec.stage, prompt: spec.prompt });
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
async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(text);
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(page.getByRole("textbox", { name: en["request.label"] })).toBeEnabled({
    timeout: 30_000,
  });
}

test("GEN-19, A62: with no tool open, a question gets its answer and nothing is made; the request after it is told the answer", async ({
  page,
}) => {
  await page.goto(app.url);
  await ask(page, "Could a tool here remind me of birthdays?");
  await expect(newestReply(page)).toHaveText(ABOUT_NONE);
  expect(listWorkspaces(app.folder)).toEqual([]);
  expect(prompts.at(-1)).toMatchObject({ stage: "discuss" });
  expect(prompts.at(-1)!.prompt).toContain("No tool is open now.");

  await ask(page, "Build it, as a shopping list with milk and eggs");
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  const [intentCall, createCall] = prompts.slice(-2);
  const before = [
    { from: "person", text: "Could a tool here remind me of birthdays?" },
    { from: "tessera", text: ABOUT_NONE },
  ];
  expect(told(intentCall!.prompt)?.last).toEqual(before);
  expect(createCall).toMatchObject({ stage: "create" });
  expect(told(createCall!.prompt)?.last).toEqual(before);
});

test("GEN-19, DATA-02, A62: a question about the open tool changes nothing, and each request is told the exchange before it", async ({
  page,
}) => {
  await page.goto(app.url);
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  const [workspace] = listWorkspaces(app.folder);
  const data = readWorkspaceData(app.folder, workspace!.id);
  await ask(page, "Would a modal be better for adding an item?");
  await expect(newestReply(page)).toHaveText(ABOUT_LIST);
  // The discuss stage was told the open tool, quoted as data.
  expect(prompts.at(-1)).toMatchObject({ stage: "discuss" });
  expect(prompts.at(-1)!.prompt).toContain("--- open tool ---");
  expect(listWorkspaces(app.folder)).toEqual([workspace]);
  expect(readWorkspaceData(app.folder, workspace!.id)).toEqual(data);
  await expect(frame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);

  await ask(page, "Do that");
  expect(told(prompts.at(-1)!.prompt)?.last).toEqual([
    { from: "person", text: "Would a modal be better for adding an item?" },
    { from: "tessera", text: ABOUT_LIST },
  ]);
  // The next request's last exchange is the one just before it.
  await ask(page, "And again");
  expect(told(prompts.at(-1)!.prompt)?.last).toEqual([
    { from: "person", text: "Do that" },
    { from: "tessera", text: en["request.clarify"] },
  ]);
  expect(steps).toHaveLength(0);
});
