import { expect, test, type Page } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { RequestLedger } from "../../server/src/ledger/index.ts";
import { UNKNOWN_USAGE, type Provider, type StageSpec } from "../../server/src/providers/index.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// A made tool never writes the person's data as it starts (GEN-06), end to end (TEST-03): the
// request goes through the real pipeline to a scripted provider (ENG-11) whose first tool writes
// an entry at startup. The host's checks refuse it before it runs (VER-01), the repair stage is
// told why (GEN-09), and the repaired tool opens with only the starting data the host installed.
// In Chrome and Edge at 320 and 1280 px (TEST-06), on a temporary data folder (ENG-19).

const intent: Intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
};

const render = `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title;
    document.getElementById("items").append(row);
  }
});`;
const tool = (js: string): Creation => ({
  outcome: "tool",
  name: "Shopping list",
  summary: "A list of what to buy.",
  code: { html: '<h1>Shopping list</h1><ul id="items" aria-label="Items"></ul>', css: "", js },
  data: {
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "title"],
            properties: { id: { type: "string" }, title: { type: "string" } },
          },
        },
      },
    },
    reusableDefaults: { items: [] },
    initialState: { items: [{ id: "i-1", title: "Milk" }] },
  },
  capabilities: [],
  uiMode: "standard",
});

const steps: { stage: string; value: unknown }[] = [
  { stage: "intent", value: intent },
  // The first tool adds an entry the moment it starts, before the person has done anything.
  {
    stage: "create",
    value: tool(
      `tessera.call("data.patch", { operations: [{ op: "add", collection: "items", record: { title: "Bread" } }] });\n${render}`,
    ),
  },
  // Its repair only reads, and leaves the starting entries to the host.
  { stage: "repair", value: tool(render) },
];
const calls: StageSpec<unknown>[] = [];
const provider: Provider = {
  name: "scripted:startup-writes",
  live: false,
  run(spec) {
    calls.push(spec);
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`No ${spec.stage} answer is scripted next.`);
    return Promise.resolve({
      value: spec.schema.parse(step.value),
      usage: UNKNOWN_USAGE,
      raw: JSON.stringify(step.value),
    });
  },
};

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());

const toolText = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

test("TEST-03, GEN-06, GEN-09: a made tool that writes data as it starts is refused before it runs, repaired, and opens with only its starting data", async ({
  page,
}) => {
  await page.goto(app.url);
  await page.getByRole("textbox", { name: en["request.label"] }).fill("A shopping list with milk");
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(newestReply(page)).toContainText("Shopping list is ready. A list of what to buy.", {
    timeout: 30_000,
  });
  await expect(toolText(page).getByRole("listitem")).toHaveText(["Milk"]);
  await page.screenshot({ path: test.info().outputPath("repaired-tool.png") });

  // The checks found the startup write, and the repair was asked to fix exactly that.
  expect(calls.map((spec) => spec.stage)).toEqual(["intent", "create", "repair"]);
  expect(calls[2]!.prompt).toContain('"data.patch" writes data during startup');
  // Only the starting data the host installed: no entry was ever written by the tool.
  const [workspace] = listWorkspaces(app.folder);
  expect(workspace?.data).toEqual({ items: [{ id: "i-1", title: "Milk" }] });
  // The ledger keeps why the repair happened (GEN-10).
  const [request] = new RequestLedger(app.folder).forWorkspace(workspace!.id);
  const repair = request?.calls.find((call) => call.stage === "repair");
  expect(repair?.diagnostics.join("\n")).toContain("writes data during startup");
});
