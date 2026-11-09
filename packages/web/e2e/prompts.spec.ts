import { expect, test, type Page } from "@playwright/test";
import type { Creation, Intent } from "../../contracts/src/index.ts";
import { RequestLedger } from "../../server/src/ledger/index.ts";
import { INTENT_PROMPT_BUDGET, PROMPT_BUDGETS } from "../../server/src/prompts/index.ts";
import { UNKNOWN_USAGE, type Provider, type StageSpec } from "../../server/src/providers/index.ts";
import { listWorkspaces } from "../../server/src/workspaces/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, type AppHost, newestReply } from "./support/app-host.ts";

// What reaches the model, end to end (TEST-03): a request typed in the app, through the real
// pipeline, to a provider that answers from a script chosen by test configuration, never by the
// request's words (ENG-11), and keeps every call it was asked to make. The person's language and
// words reach the model as written (GEN-15); what a request says never switches a prompt part on
// or off (GEN-02); every call is built from versioned parts, recorded in the data folder's
// ledger and kept within its budget (GEN-03). In Chrome and Edge at 320 and 1280 px (TEST-06), on
// a temporary data folder (ENG-19). The tests run in order, each taking the next answers.

const intent = (kind: Intent["kind"], language = "en"): Intent =>
  ({
    kind,
    interfacePart: null,
    dataPart: null,
    behaviorChange: false,
    lookOnly: false,
    targetsCurrentTool: false,
    language,
    features: [],
  }) as Intent;

/** A list tool, named and filled as the scenario needs, that passes every check. */
const list = (name: string, summary: string, items: string[]): Creation => ({
  outcome: "tool",
  name,
  summary,
  code: {
    html: `<h1>${name}</h1><ul id="items" aria-label="${name}"></ul>`,
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
    initialState: { items: items.map((title, i) => ({ id: `i-${i + 1}`, title })) },
  },
  capabilities: [],
  uiMode: "standard",
});

const steps: { stage: string; value: unknown }[] = [
  // 1. A request in Portuguese.
  { stage: "intent", value: intent("create", "pt-BR") },
  {
    stage: "create",
    value: list("Lista de compras", "Uma lista do que comprar.", ["Leite", "Ovos"]),
  },
  // 2. Two requests that differ in every word the POC once switched parts on (L-20), and alike
  // in what the intent stage decided.
  { stage: "intent", value: intent("new_tool") },
  {
    stage: "create",
    value: list("Party layout", "Where each guest sits.", ["Table 1", "Table 2"]),
  },
  { stage: "intent", value: intent("new_tool") },
  { stage: "create", value: list("Reading list", "Books to read next.", ["Dune", "Emma"]) },
];

/** Every call the pipeline made, in order, as it reached the provider. */
const calls: StageSpec<unknown>[] = [];
const provider: Provider = {
  name: "scripted:prompts",
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

// The tests share one script and one Tessera: if one fails, the later ones are skipped, never run
// on a fresh worker against answers meant for the steps before them (#186).
test.describe.configure({ mode: "serial" });

let app: AppHost;
test.beforeAll(async () => {
  app = await startApp(undefined, provider);
});
test.afterAll(() => app.close());

const toolText = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

async function ask(page: Page, request: string) {
  await page.getByRole("textbox", { name: en["request.label"] }).fill(request);
  await page.getByRole("button", { name: en["request.send"] }).click();
}

/** A call's part names, without their versions. */
const partNames = (spec: StageSpec<unknown>) =>
  (spec.promptParts ?? []).map((p) => p.split("@")[0]);

test("TEST-03, GEN-15: a request in Portuguese makes a tool in Portuguese, and its words and language reach the model as written", async ({
  page,
}) => {
  const request = "Preciso de uma lista de compras com leite e ovos";
  await page.goto(app.url);
  await ask(page, request);
  await expect(newestReply(page)).toContainText(
    "Lista de compras is ready. Uma lista do que comprar.",
    {
      timeout: 30_000,
    },
  );
  // The app's sentence stays English and the tool's summary, in the person's language, follows on
  // a line of its own: no sentence mixes the two (A55, GEN-12).
  expect(await newestReply(page).innerText()).toContain(
    "Lista de compras is ready.\nUma lista do que comprar.",
  );
  await expect(toolText(page).getByRole("listitem")).toHaveText(["Leite", "Ovos"]);
  await page.screenshot({ path: test.info().outputPath("portuguese-tool.png") });

  const [asked, made] = calls;
  // The request, word for word: no prefix, no translation, in both stages.
  expect(asked?.stage).toBe("intent");
  expect(asked?.prompt.endsWith(`The request:\n${request}`)).toBe(true);
  expect(made?.stage).toBe("create");
  expect(made?.prompt).toContain(request);
  // The language the intent stage found is given to creation as a fact, for the tool's words.
  expect(made?.prompt).toContain("The person's language, as a BCP 47 tag: pt-BR.");
  expect(partNames(made!)).toContain("language");
});

test("GEN-02, GEN-03: a request's words never switch a prompt part on or off, and every call keeps its parts in the ledger, within budget", async ({
  page,
}) => {
  await page.goto(app.url);
  // L-20: the POC added its engine section only for words like "simulation" or "will it work".
  await ask(page, "Will my party layout work? I want to simulate where everyone sits.");
  await expect(newestReply(page)).toContainText("Party layout is ready. Where each guest sits.", {
    timeout: 30_000,
  });
  await ask(page, "A list of books to read");
  await expect(newestReply(page)).toContainText("Reading list is ready. Books to read next.", {
    timeout: 30_000,
  });

  const creations = calls.filter((spec) => spec.stage === "create");
  expect(creations).toHaveLength(3);
  const [, party, books] = creations;
  // The same intent decision, so the same parts, whatever the request said (GEN-02).
  expect(partNames(party!)).toEqual(partNames(books!));
  // Built from parts: the base rules, the bridge manifest, the UI standard and the request.
  expect(partNames(party!)).toEqual(
    expect.arrayContaining(["base", "bridge", "ui-standard", "create", "request"]),
  );

  // The data folder's ledger keeps each call's parts and size (GEN-03, ENG-16), within budget.
  const ledger = new RequestLedger(app.folder);
  let checked = 0;
  for (const workspace of listWorkspaces(app.folder)) {
    for (const request of ledger.forWorkspace(workspace.id)) {
      for (const call of request.calls) {
        checked += 1;
        const asked = calls.find(
          (spec) =>
            spec.stage === call.stage &&
            spec.prompt.length === call.promptChars &&
            spec.system.length === call.systemChars,
        );
        expect(asked, `${workspace.title}: the ${call.stage} call`).toBeDefined();
        expect(call.promptParts).toEqual(asked!.promptParts);
        const budget =
          call.stage === "intent" ? INTENT_PROMPT_BUDGET : PROMPT_BUDGETS[call.stage as "create"];
        expect(call.promptChars + call.systemChars).toBeLessThanOrEqual(budget);
      }
    }
  }
  // Three requests, each an intent call and a creation, all in the ledger.
  expect(checked).toBe(6);
});
