import { expect, test } from "@playwright/test";
import { internalTerms, type Creation, type Intent } from "../../contracts/src/index.ts";
import { UNKNOWN_USAGE, type Provider } from "../../server/src/providers/index.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// Plain language end to end (GEN-12, TEST-03): a request through the real pipeline to a scripted
// provider (ENG-11) whose first tool is named in Tessera's own words, as the POC's "Capability
// declaration fix" was (L-36). The host refuses that name, the repair names it in plain words, and
// nothing the person reads along the way, progress included, uses a word for Tessera's own
// parts. In Chrome and Edge at 320 and 1280 px (TEST-06), on a temporary data folder (ENG-19).

const intent = {
  kind: "create",
  interfacePart: null,
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [],
} as Intent;
const tool = (name: string, summary: string): Creation => ({
  outcome: "tool",
  name,
  summary,
  code: {
    html: '<h1>Shopping list</h1><ul id="items" aria-label="Items"></ul>',
    css: "",
    js: `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title;
    document.getElementById("items").append(row);
  }
});`,
  },
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

const steps: { stage: string; value: unknown; delayMs?: number }[] = [
  { stage: "intent", value: intent },
  // Slow enough for the progress to be read, then named in Tessera's own words.
  {
    stage: "create",
    value: tool("Capability declaration fix", "A schema for the list's state."),
    delayMs: 1500,
  },
  { stage: "repair", value: tool("Shopping list", "A list of what to buy."), delayMs: 1500 },
];
const provider: Provider = {
  name: "scripted:plain-language",
  live: false,
  async run(spec) {
    const step = steps.shift();
    if (step?.stage !== spec.stage) throw new Error(`No ${spec.stage} answer is scripted next.`);
    if (step.delayMs) await new Promise((done) => setTimeout(done, step.delayMs));
    return {
      value: spec.schema.parse(step.value),
      usage: UNKNOWN_USAGE,
      raw: JSON.stringify(step.value),
    };
  },
};

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());

test("TEST-03, GEN-12: a tool named in Tessera's own words is renamed before anyone reads it, and nothing shown along the way uses such words", async ({
  page,
}) => {
  // Every text the page announces while the request runs, as the person would hear it.
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { announced: Set<string> }).announced = seen;
    new MutationObserver(() => {
      for (const status of document.querySelectorAll("[role=status]")) {
        const text = (status as HTMLElement).innerText.trim();
        if (text) seen.add(text);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(app.url);
  const request = "A shopping list with milk";
  await page.getByRole("textbox", { name: en["request.label"] }).fill(request);
  await page.getByRole("button", { name: en["request.send"] }).click();
  await expect(newestReply(page)).toContainText("Shopping list is ready. A list of what to buy.", {
    timeout: 30_000,
  });
  await page.screenshot({ path: test.info().outputPath("plain-tool.png") });

  // The internal name never became the tool's, and the person read none of it.
  expect(listWorkspaces(app.folder).map((w) => w.title)).toEqual(["Shopping list"]);
  const announced = await page.evaluate(() => [
    ...(window as unknown as { announced: Set<string> }).announced,
  ]);
  // The progress was shown, repair included, in the app's own words.
  expect(announced).toContain(en["request.stage.repair"]);
  for (const text of [...announced, await page.locator("body").innerText()]) {
    expect(internalTerms(text, request), text).toEqual([]);
  }
});
