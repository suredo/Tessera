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
  // A list that saves each item it adds, shows what its data holds, and says when a save fails.
  saver: {
    html: '<label for="name">Item</label> <input id="name" data-hook="item-name"> <button data-hook="item-add">Add</button><p data-hook="error"></p><ul></ul>',
    css: "",
    js: `const list = document.querySelector("ul");
const show = () => tessera.call("data.read").then(({ data }) => {
  list.replaceChildren(...data.items.map((record) => {
    const item = document.createElement("li");
    item.dataset.hook = "item";
    item.textContent = record.name;
    return item;
  }));
});
show();
document.querySelector("[data-hook=item-add]").addEventListener("click", () => {
  const name = document.querySelector("[data-hook=item-name]").value;
  tessera
    .call("data.patch", { operations: [{ op: "add", collection: "items", record: { name } }] })
    .then(show, (error) => { document.querySelector("[data-hook=error]").textContent = error.code; });
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

/**
 * Stages the saver with one check that drives it in the smoke check's panel, then starts it again
 * for a rehearsal and drives it, then reopens it on what it saved and reads its list. Returns the
 * answers, the starting data as it stands afterwards, and the bridge requests the page sent.
 */
async function rehearse(page: Page) {
  const bridgeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/bridge")) bridgeRequests.push(request.url());
  });
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      stageCandidate(options: unknown): Promise<unknown>;
      driveTool(tool: unknown, steps: unknown): Promise<unknown>;
    };
    const syntheticData = { items: [{ id: "i-1", name: "Milk" }] };
    const add = [
      { do: "fill", hook: "item-name", value: "Eggs" },
      { do: "click", hook: "item-add" },
      { do: "read", hook: "error" },
      { do: "read", hook: "item" },
    ];
    const answers: unknown[] = [];
    const staged = await w.stageCandidate({
      candidate: { mountId: "saver", hash: "a".repeat(64), capabilities: [], syntheticData },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      activationToken: "00000000-0000-4000-8000-000000000001",
      checks: [
        {
          name: "behavior",
          run: async ({ tool, rehearse }: { tool: unknown; rehearse: () => Promise<unknown> }) => {
            answers.push(await w.driveTool(tool, add));
            answers.push(await w.driveTool(await rehearse(), add));
            answers.push(await w.driveTool(await rehearse(), [{ do: "read", hook: "item" }]));
            return { ok: true };
          },
        },
        // The next check gets a live candidate in the staging phase again, which can't save,
        // and its own rehearsal starts on a fresh copy.
        {
          name: "next",
          run: async ({ tool, rehearse }: { tool: unknown; rehearse: () => Promise<unknown> }) => {
            answers.push(await w.driveTool(tool, add));
            answers.push(await w.driveTool(await rehearse(), [{ do: "read", hook: "item" }]));
            return { ok: true };
          },
        },
      ],
      activate: () => Promise.resolve({ ok: false, reason: "stale", message: "Not stored." }),
    });
    return { answers, syntheticData, staged };
  });
  return { ...result, bridgeRequests };
}

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
    { do: "find", hook: "item", value: "Eggs" },
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
      { ok: true, count: 2, matches: [1] },
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

test("BRG-06, VER-03: in the smoke check's panel a save is refused; in a rehearsal it goes to a throwaway copy that a reopen shows, and never to the server; the next check starts afresh", async ({
  page,
}) => {
  const { answers, syntheticData, bridgeRequests, staged } = await rehearse(page);
  const steps = (answer: unknown) => (answer as DriveReport).steps;
  // Before the rehearsal, the candidate can't save (BRG-06).
  expect(steps(answers[0])).toEqual([
    { ok: true },
    { ok: true },
    { ok: true, count: 1, texts: ["not-active"] },
    { ok: true, count: 1, texts: ["Milk"] },
  ]);
  // Rehearsing, its save goes to the throwaway copy, and it shows it.
  expect(steps(answers[1])).toEqual([
    { ok: true },
    { ok: true },
    { ok: true, count: 1, texts: [""] },
    { ok: true, count: 2, texts: ["Milk", "Eggs"] },
  ]);
  // Reopened, it shows what it saved.
  expect(steps(answers[2])).toEqual([{ ok: true, count: 2, texts: ["Milk", "Eggs"] }]);
  // The next check's candidate is live and can't save, and its rehearsal starts afresh.
  expect(steps(answers[3])).toEqual([
    { ok: true },
    { ok: true },
    { ok: true, count: 1, texts: ["not-active"] },
    { ok: true, count: 1, texts: ["Milk"] },
  ]);
  expect(steps(answers[4])).toEqual([{ ok: true, count: 1, texts: ["Milk"] }]);
  // Every check passed, so staging went on to activation.
  expect(staged).toMatchObject({ outcome: "refused", message: "Not stored." });
  // The starting data it was given is unchanged, and nothing reached the server's bridge.
  expect(syntheticData).toEqual({ items: [{ id: "i-1", name: "Milk" }] });
  expect(bridgeRequests).toEqual([]);
});
