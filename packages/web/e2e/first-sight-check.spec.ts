import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The first-sight check (UX-01, GEN-05, A85), in Chrome (TEST-06): in staging, after the smoke
// check, a new tool is opened on a throwaway copy of its starting data, the request's entries in
// it, and read as the person sees it. A tool that shows them passes; one that shows none, one with
// unlabelled examples, and one whose date field starts on a fixed past day each fail, saying why.

type Kind =
  | "shows"
  | "ignores"
  | "inField"
  | "labelledExamples"
  | "sampleExamples"
  | "japaneseExamples"
  | "unlabelledExamples"
  | "pastDate"
  | "pastWeek"
  | "today";

/** How each kind that labels its examples words the label, in its own language (#384 review). */
const LABELS: Partial<Record<Kind, string>> = {
  labelledExamples: "An example: ",
  sampleExamples: "Sample data: ",
  japaneseExamples: "サンプル: ",
};

/** A list tool of the kind `kind` says: showing its data, or not, with a date field. */
const tool = (kind: Kind): Artifact["code"] => ({
  html: `<h1>Errands</h1>
<label for="due">Due</label> <input id="due" type="date"${kind === "pastDate" ? ' value="2020-01-01"' : ""}>
<label for="week">Week</label> <input id="week" type="week"${kind === "pastWeek" ? ' value="2020-W01"' : ""}>
<ul id="items"></ul>`,
  css: "",
  js: `const kind = ${JSON.stringify(kind)};
const label = ${JSON.stringify(LABELS[kind] ?? null)};
const list = document.getElementById("items");
${kind === "today" ? `tessera.call("clock.now").then((clock) => { document.getElementById("due").value = clock.date; });` : ""}
tessera.call("data.read").then(({ data }) => {
  if (kind === "ignores") { list.textContent = "Nothing here yet."; return; }
  list.replaceChildren(...data.items.map((item) => {
    const row = document.createElement("li");
    if (kind === "inField") {
      const field = document.createElement("input");
      field.setAttribute("aria-label", "Errand");
      field.value = item.title;
      row.append(field);
    } else {
      // An example labelled in the tool's own words, and marked as one (A85).
      if (item.example && label) row.dataset.example = "";
      row.textContent = (item.example && label ? label : "") + item.title;
    }
    return row;
  }));
});`,
});

const kinds: Kind[] = [
  "shows",
  "ignores",
  "inField",
  "labelledExamples",
  "sampleExamples",
  "japaneseExamples",
  "unlabelledExamples",
  "pastDate",
  "pastWeek",
  "today",
];
let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(kinds.map((kind) => [kind, tool(kind)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };
const defaults = { items: [] };
const entries = {
  items: [
    { id: "i-1", title: "Pick up the dry cleaning" },
    { id: "i-2", title: "Call the plumber" },
  ],
};
const examples = { items: [{ id: "e-1", title: "Water the plants", example: true }] };

/** Stages a tool behind the smoke check and the first-sight check; activation is refused. */
async function check(page: Page, kind: Kind, starting: object): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, defaults, starting }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        firstSightCheck(defaults: unknown, starting: unknown): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: ["clock"],
          syntheticData: defaults,
          startingData: starting,
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.firstSightCheck(defaults, starting)],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: kind, defaults, starting },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("UX-01, GEN-05: a new tool that shows the request's entries when it opens passes", async ({
  page,
}) => {
  expect(await check(page, "shows", entries)).toEqual(PASSED);
});

test("UX-01: so does one that shows them in fields, one that labels its examples, and one whose date starts today", async ({
  page,
}) => {
  expect(await check(page, "inField", entries)).toEqual(PASSED);
  expect(await check(page, "labelledExamples", examples)).toEqual(PASSED);
  // Whatever its words, in whatever language: the mark says which are examples (#384 review).
  expect(await check(page, "sampleExamples", examples)).toEqual(PASSED);
  expect(await check(page, "japaneseExamples", examples)).toEqual(PASSED);
  expect(await check(page, "today", entries)).toEqual(PASSED);
});

for (const [kind, title, starting, words] of [
  [
    "ignores",
    "shows none of the request's entries",
    entries,
    /The request gave entries, such as "pick up the dry cleaning", but the tool shows none of them when it opens/,
  ],
  [
    "unlabelledExamples",
    "marks none of its examples as examples",
    examples,
    /The tool starts with examples but marks none of them as an example/,
  ],
  [
    "pastWeek",
    "has a week field that starts on a past week",
    entries,
    /A date field starts on 2020-W01, before today/,
  ],
  [
    "pastDate",
    "has a date field that starts on a fixed past day",
    entries,
    /A date field starts on 2020-01-01, before today, \d{4}-\d{2}-\d{2}\. Start dates from tessera\.call\("clock\.now"\)/,
  ],
] as const) {
  test(`UX-01, RUN-07: a new tool that ${title} fails the first-sight check, saying why`, async ({
    page,
  }) => {
    const result = await check(page, kind, starting);
    expect(result).toMatchObject({ outcome: "check-failed", check: "first-sight" });
    expect(result.reason).toMatch(words);
  });
}
