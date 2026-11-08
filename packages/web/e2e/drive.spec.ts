import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import type { DriveReport, DriveStep } from "../../runtime/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// Driving a candidate for a behavior check (VER-03), in Chrome and Edge (TEST-06): in the hidden
// staging panel, a check fills in, clicks and reads the elements a tool marks with hooks in its
// `data-hook` attribute, each step once the tool has settled, and hears what was missing when a
// step can't be done.

const tools: Record<string, Artifact["code"]> = {
  // A list kept in memory, with its starting items read from its data.
  list: {
    html: '<label for="name">Item</label> <input id="name" data-hook="item-name"> <button data-hook="item-add">Add</button><ul></ul>',
    css: "",
    js: `const list = document.querySelector("ul");
const show = (name) => {
  const item = document.createElement("li");
  item.dataset.hook = "item";
  item.append(name + " ");
  const remove = document.createElement("button");
  remove.dataset.hook = "item-remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => item.remove());
  item.append(remove);
  list.append(item);
};
tessera.call("data.read").then(({ data }) => data.items.forEach((item) => show(item.name)));
document.querySelector("[data-hook=item-add]").addEventListener("click", () => {
  const field = document.querySelector("[data-hook=item-name]");
  // Adding waits on two calls, as saving and reading back would, the second made after a quiet
  // moment that follows the first's reply, and shows the item a moment after the second's: the
  // step must wait for the calls to settle, then for a quiet moment after the last of them.
  const later = (ms) => new Promise((done) => setTimeout(done, ms));
  tessera
    .call("data.read")
    .then(() => later(60))
    .then(() => tessera.call("data.read"))
    .then(() => later(45))
    .then(() => {
      show(field.value);
      field.value = "";
    });
});`,
  },
  // A hooked element that is neither a field nor a button.
  text: { html: '<p data-hook="total">0</p>', css: "", js: "" },
};

let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

/** Stages `mountId` with one check that drives it with `steps`; returns what its page answered. */
async function drive(page: Page, mountId: string, steps: DriveStep[]): Promise<DriveReport> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, steps }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<unknown>;
        driveTool(tool: unknown, steps: unknown): Promise<unknown>;
      };
      let report: unknown;
      await w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: [],
          syntheticData: { items: [{ id: "i-1", name: "Milk" }] },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [
          {
            name: "drive",
            run: async ({ tool }: { tool: unknown }) => {
              report = await w.driveTool(tool, steps);
              return { ok: true };
            },
          },
        ],
        // Refused, so nothing is stored.
        activate: () => Promise.resolve({ ok: false, reason: "stale", message: "Not stored." }),
      });
      return report as DriveReport;
    },
    { mountId, steps },
  );
}

test("VER-03: a check fills in, clicks and reads hooked elements, each step once the tool has settled and shown the result", async ({
  page,
}) => {
  const report = await drive(page, "list", [
    { do: "read", hook: "item" },
    { do: "fill", hook: "item-name", value: "Eggs" },
    { do: "click", hook: "item-add" },
    { do: "read", hook: "item" },
    { do: "click", hook: "item-remove", index: 0 },
    { do: "read", hook: "item" },
  ]);
  expect(report).toEqual({
    problems: [],
    steps: [
      { ok: true, count: 1, texts: ["Milk Remove"] },
      { ok: true },
      { ok: true },
      { ok: true, count: 2, texts: ["Milk Remove", "Eggs Remove"] },
      { ok: true },
      { ok: true, count: 1, texts: ["Eggs Remove"] },
    ],
  });
});

test("VER-03: a step that can't be done ends the answer, saying what was missing", async ({
  page,
}) => {
  expect(await drive(page, "list", [{ do: "click", hook: "item-save" }])).toEqual({
    problems: [],
    steps: [{ ok: false, problem: 'Nothing has the hook "item-save".' }],
  });
  expect(
    await drive(page, "list", [
      { do: "click", hook: "item-remove", index: 3 },
      { do: "read", hook: "item" },
    ]),
  ).toEqual({
    problems: [],
    steps: [
      {
        ok: false,
        problem: 'Only 1 element has the hook "item-remove", so there is no number 4.',
      },
    ],
  });
  expect(await drive(page, "text", [{ do: "fill", hook: "total", value: "3" }])).toEqual({
    problems: [],
    steps: [{ ok: false, problem: 'The element with the hook "total" can\'t be filled in.' }],
  });
  expect(await drive(page, "text", [{ do: "read", hook: 'total"], body' }])).toEqual({
    problems: [],
    steps: [{ ok: false, problem: '"total"], body" isn\'t a hook name.' }],
  });
});
