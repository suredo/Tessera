import { expect, test, type Page } from "@playwright/test";
import type { Intent } from "../../contracts/src/index.ts";
import { TWO_PASS_STARTING_POINT } from "../../server/src/generation/index.ts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces, workspaceVersions } from "../../server/src/workspaces/index.ts";
import { editFixture, styleEdit } from "../../server/test/fixtures/edit-tool.ts";
import { en } from "../src/i18n/en.ts";
import { newestReply, startApp, type AppHost } from "./support/app-host.ts";

// A big tool in two passes, end to end (GEN-17, TEST-03): a request with four features makes a
// working core first, staged and activated; then each feature still to come arrives as its own
// edit, staged and activated in turn; and the chat says what is ready and what was added. The
// model's answers come from a script (ENG-11); the server is told to make big tools in two passes.
// On a temporary data folder (ENG-19).

const features = ["Items", "Ticking off", "Aisles", "Prices"].map((name) => ({
  name,
  request: `${name.toLowerCase()} please`,
}));
const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  language: "en",
  features,
  targetsCurrentTool: false,
  behaviorChange: false,
  lookOnly: false,
};
/** An edit with its own look, so each one changes the tool. */
const edit = (summary: string, background: string) => ({
  ...styleEdit,
  summary,
  files: {
    mode: "replace" as const,
    code: { ...editFixture.code, css: `body{background:${background};color:#eee}` },
  },
});
const steps = [
  { stage: "intent", value: intent },
  { stage: "create", value: editFixture },
  { stage: "edit", value: edit("Added aisles.", "#123") },
  { stage: "edit", value: edit("Added prices.", "#234") },
];
const asked: string[] = [];
const provider: Provider = {
  name: "scripted:two-pass",
  live: false,
  run(spec) {
    asked.push(spec.stage);
    const step = steps.shift();
    if (step?.stage !== spec.stage) {
      return Promise.reject(new Error(`No ${spec.stage} answer is scripted next.`));
    }
    return Promise.resolve({
      value: spec.schema.parse(step.value),
      usage: UNKNOWN_USAGE,
      raw: JSON.stringify(step.value),
    });
  },
};

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider, { twoPass: TWO_PASS_STARTING_POINT });
});
test.afterAll(() => app.close());

const toolFrame = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

test("GEN-17, TEST-03, GEN-08: a big tool's core is made and activated first, then each feature still to come, each said in the chat", async ({
  page,
}) => {
  await page.goto(app.url);
  await page
    .getByRole("textbox", { name: en["request.label"] })
    .fill("A shopping list with four things");
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(newestReply(page)).toHaveText(
    "Shopping list is ready. A list of what to buy. Aisles was added. Added aisles. Prices was added. Added prices.",
    { timeout: 60_000 },
  );
  // The last feature's version is the one running, with the request's entries kept throughout.
  await expect(toolFrame(page).locator("body")).toHaveCSS("background-color", "rgb(34, 51, 68)");
  await expect(toolFrame(page).getByRole("listitem")).toHaveText(["Milk", "Eggs"]);
  const [workspace] = listWorkspaces(app.folder);
  expect(workspaceVersions(app.folder, workspace!.id)).toHaveLength(3);
  // No intent call was spent on a feature.
  expect(asked).toEqual(["intent", "create", "edit", "edit"]);
});
