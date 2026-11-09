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
  // A select whose choices' values aren't what they say, and items it hides.
  picker: {
    html: '<label for="pick">Show</label> <select id="pick" data-hook="pick"><option value="">All</option><option value="f">Fiction</option><option value="h">History</option></select><ul><li data-hook="book" data-genre="f">Dune</li><li data-hook="book" data-genre="h">SPQR</li><li data-hook="book" data-genre="h" style="visibility: hidden">Gone</li></ul>',
    css: "",
    js: `const pick = document.querySelector("[data-hook=pick]");
pick.addEventListener("change", () => {
  for (const book of document.querySelectorAll("[data-hook=book]")) {
    book.hidden = pick.value !== "" && book.dataset.genre !== pick.value;
  }
});`,
  },
  // Sessions that mark their dates in each way a check reads, or don't, and one hidden.
  dated: {
    html: `<ul>
<li data-hook="session"><time datetime="2026-11-12">Thursday</time> Algebra</li>
<li data-hook="session">Geometry <time datetime="2026-11-13T18:00">6 pm</time></li>
<li><time data-hook="session" datetime=" 2026-11-14 ">Saturday</time></li>
<li data-hook="session">No date</li>
<li data-hook="session"><time datetime="14/11/2026">14 Nov</time></li>
<li data-hook="session"><time>2026-11-15</time></li>
<li data-hook="session"><time datetime="2026-11-150">Typo</time></li>
<li data-hook="session"><time datetime="2026-11-12garbage">Junk</time></li>
<li data-hook="session"><time datetime="2026-02-30">30 Feb</time></li>
<li data-hook="session"><time datetime="2026-13-01">Month 13</time></li>
<li data-hook="session"><time datetime="0000-00-00">Zero</time></li>
<li data-hook="session"><time datetime="2028-02-29 09:30:15.5+01:00">Leap day</time></li>
<li data-hook="session" hidden><time datetime="2026-11-16">Hidden</time></li>
</ul>`,
    css: "",
    js: "",
  },
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

/** A read's answer: how many, their texts, and a fingerprint of each whole text. */
const read = (count: number, texts: string[]) => ({
  ok: true,
  count,
  texts,
  digests: texts.map(() => expect.stringMatching(/^[0-9a-z]+$/)),
});

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
    { do: "read", hook: "item", start: 1 },
    { do: "click", hook: "item-remove", index: 0 },
    { do: "read", hook: "item" },
  ]);
  expect(report).toEqual({
    problems: [],
    steps: [
      read(1, ["Milk Remove"]),
      { ok: true },
      { ok: true },
      read(2, ["Milk Remove", "Eggs Remove"]),
      { ok: true, count: 2, matches: [1] },
      read(2, ["Eggs Remove"]),
      { ok: true },
      read(1, ["Eggs Remove"]),
    ],
  });
});

test("VER-03: a read gives the first 200 characters of each text and a fingerprint of the whole, so texts that differ only past them are told apart", async ({
  page,
}) => {
  const long = "word ".repeat(45);
  const report = await drive(page, "list", [
    { do: "fill", hook: "item-name", value: `${long}one` },
    { do: "click", hook: "item-add" },
    { do: "fill", hook: "item-name", value: `${long}two` },
    { do: "click", hook: "item-add" },
    { do: "read", hook: "item" },
    { do: "read", hook: "item", start: 1 },
  ]);
  const [all, from] = report.steps.slice(4) as { texts: string[]; digests: string[] }[];
  expect(all!.texts.map((text) => text.length)).toEqual([11, 200, 200]);
  expect(all!.texts[1]).toBe(all!.texts[2]);
  expect(new Set(all!.digests).size).toBe(3);
  expect(from!.digests).toEqual(all!.digests.slice(1));
});

test("VER-03: a check reads the date each hooked element marks with a time element, whatever language it shows it in", async ({
  page,
}) => {
  const report = await drive(page, "dated", [
    { do: "dates", hook: "session" },
    { do: "dates", hook: "session", start: 5 },
  ]);
  expect(report).toEqual({
    problems: [],
    steps: [
      {
        ok: true,
        count: 12,
        dates: [
          "2026-11-12",
          "2026-11-13",
          "2026-11-14",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          "2028-02-29",
        ],
      },
      { ok: true, count: 12, dates: [null, null, null, null, null, null, "2028-02-29"] },
    ],
  });
});

test("VER-03: a check chooses a select's choice by its value or by what it says, and reads only what is shown", async ({
  page,
}) => {
  expect(
    await drive(page, "picker", [
      { do: "read", hook: "book" },
      { do: "fill", hook: "pick", value: "History" },
      { do: "read", hook: "book" },
      { do: "fill", hook: "pick", value: "f" },
      { do: "find", hook: "book", value: "Dune" },
      { do: "fill", hook: "pick", value: "" },
      { do: "read", hook: "book" },
      { do: "fill", hook: "pick", value: "Poetry" },
      { do: "read", hook: "book" },
    ]),
  ).toEqual({
    problems: [],
    steps: [
      read(2, ["Dune", "SPQR"]),
      { ok: true },
      read(1, ["SPQR"]),
      { ok: true },
      { ok: true, count: 1, matches: [0] },
      { ok: true },
      read(2, ["Dune", "SPQR"]),
      { ok: false, problem: 'The select with the hook "pick" has no choice "Poetry".' },
    ],
  });
});

test("VER-03: a check reads what a hooked field is, so it can fill it with a value it takes", async ({
  page,
}) => {
  const report = await drive(page, "picker", [{ do: "fields", hook: "pick" }]);
  expect(report).toEqual({
    problems: [],
    steps: [
      {
        ok: true,
        count: 1,
        fields: [
          {
            kind: "select",
            type: "",
            name: "",
            required: false,
            checked: false,
            min: "",
            max: "",
            step: "",
            maxLength: -1,
            choices: ["", "f", "h"],
            value: "",
          },
        ],
      },
    ],
  });
});

test("VER-03: a step that can't be done ends the answer, saying what was missing", async ({
  page,
}) => {
  expect(await drive(page, "list", [{ do: "click", hook: "item-save" }])).toEqual({
    problems: [],
    steps: [{ ok: false, problem: 'Nothing shown has the hook "item-save".' }],
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
        problem: 'Only 1 element shown has the hook "item-remove", so there is no number 4.',
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
    read(1, ["not-active"]),
    read(1, ["Milk"]),
  ]);
  // Rehearsing, its save goes to the throwaway copy, and it shows it.
  expect(steps(answers[1])).toEqual([
    { ok: true },
    { ok: true },
    read(1, [""]),
    read(2, ["Milk", "Eggs"]),
  ]);
  // Reopened, it shows what it saved.
  expect(steps(answers[2])).toEqual([read(2, ["Milk", "Eggs"])]);
  // The next check's candidate is live and can't save, and its rehearsal starts afresh.
  expect(steps(answers[3])).toEqual([
    { ok: true },
    { ok: true },
    read(1, ["not-active"]),
    read(1, ["Milk"]),
  ]);
  expect(steps(answers[4])).toEqual([read(1, ["Milk"])]);
  // Every check passed, so staging went on to activation.
  expect(staged).toMatchObject({ outcome: "refused", message: "Not stored." });
  // The starting data it was given is unchanged, and nothing reached the server's bridge.
  expect(syntheticData).toEqual({ items: [{ id: "i-1", name: "Milk" }] });
  expect(bridgeRequests).toEqual([]);
});
