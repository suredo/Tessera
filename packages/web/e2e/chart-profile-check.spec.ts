import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The chart profile's behavior check (VER-03), in Chrome (TEST-06): in staging, after the
// smoke check, it reads what the chart helper drew (CAP-04) and the total, adds an entry of its
// own, and expects the chart to show it with the others as they were and the total to be the new
// sum, then opens the tool again, its saves going to a throwaway copy (BRG-06). A good tool passes,
// however it writes its total; each deliberately broken one fails, saying what was expected, what
// was observed and whose rule it is (VER-07).

type Flaw =
  | "none"
  | "portuguese"
  | "staleTotal"
  | "staleChart"
  | "rounded"
  | "notSaved"
  | "twoSeries"
  | "renumbers"
  | "savesRenumbered";

/** A spending chart that fits the chart profile, with `flaw` built in. */
const spending = (flaw: Flaw): Artifact["code"] => ({
  html: `<label for="name">What</label> <input id="name" data-hook="entry-name">
<label for="amount">How much</label> <input id="amount" data-hook="entry-value" inputmode="decimal">
<button data-hook="entry-add">Add</button>
<div data-hook="chart"></div>
<p>Total: <span data-hook="total"></span></p>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
let drawnOnce = false;
const format = (n) => flaw === "portuguese"
  ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"
  : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const render = () => {
  const entries = state.data.entries;
  // One flaw draws the chart only the first time; one shows its numbers rounded.
  // With no entries there is nothing to chart, so the element stays empty.
  if (entries.length === 0) document.querySelector("[data-hook=chart]").replaceChildren();
  else if (!(flaw === "staleChart" && drawnOnce)) {
    const values = entries.map((e) => flaw === "rounded" ? Math.round(e.amount) : e.amount);
    const series = [{ name: "Spent", values }];
    if (flaw === "twoSeries") series.push({ name: "Budget", values: entries.map(() => 500) });
    tessera.chart(document.querySelector("[data-hook=chart]"), { type: "bar", title: "Spending this month", labels: entries.map((e) => e.name), series });
    drawnOnce = true;
  }
  // One flaw leaves the total as it first was.
  const counted = flaw === "staleTotal" ? entries.filter((e) => !e.id.startsWith("added")) : entries;
  document.querySelector("[data-hook=total]").textContent = format(counted.reduce((sum, e) => sum + e.amount, 0));
};
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
document.querySelector("[data-hook=entry-add]").addEventListener("click", () => {
  const name = document.querySelector("[data-hook=entry-name]").value.trim();
  const amount = Number(document.querySelector("[data-hook=entry-value]").value);
  if (!name || !Number.isFinite(amount)) return;
  if (flaw === "notSaved" || flaw === "staleTotal") {
    state.data.entries.push({ id: "added-" + state.data.entries.length, name, amount });
    if (flaw === "notSaved") return render();
  }
  if (flaw === "staleTotal") return render();
  // Two flaws number the other entries' names anew as they add one: one shows that, the other
  // shows the names as they were until the tool is opened again.
  if (flaw === "renumbers" || flaw === "savesRenumbered") {
    const kept = [...state.data.entries, { id: "added", name, amount }];
    const renames = state.data.entries.map((e, i) => ({ op: "replace", collection: "entries", id: e.id, revisionCount: state.revisions.entries[e.id], fields: { name: (i + 2) + ". " + e.name.replace(/^[0-9]+[.] /, "") } }));
    return tessera.call("data.patch", { operations: [...renames, { op: "add", collection: "entries", record: { name, amount } }] }).then(() => {
      if (flaw === "renumbers") return load();
      state.data.entries = kept;
      render();
    });
  }
  tessera.call("data.patch", { operations: [{ op: "add", collection: "entries", record: { name, amount } }] }).then(load);
});`,
});

const flaws: Flaw[] = [
  "none",
  "portuguese",
  "staleTotal",
  "staleChart",
  "rounded",
  "notSaved",
  "twoSeries",
  "renumbers",
  "savesRenumbered",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(
    Object.fromEntries(
      flaws.map((flaw) => [
        flaw,
        {
          code: spending(flaw),
          ui: { standardVersion: 1, mode: "standard" as const },
          capabilities: ["chart"],
        },
      ]),
    ),
  );
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

const SPENT = [
  { name: "Rent", amount: 1200 },
  { name: "Food", amount: 450 },
  { name: "Transport", amount: 120 },
  { name: "Fun", amount: 200 },
];

/** Stages a tool behind the smoke check and the chart check; activation is refused. */
async function check(page: Page, flaw: Flaw, entries = SPENT): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, entries }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        profileCheck(id: string): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: ["chart"],
          syntheticData: { entries: entries.map((entry, i) => ({ id: `e-${i + 1}`, ...entry })) },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("chart")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, entries },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("VER-03, CAP-04: a spending chart that shows each entry and their total, and keeps them, passes the chart check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one that writes its total the Portuguese way, or starts with no entries", async ({
  page,
}) => {
  expect(await check(page, "portuguese")).toEqual(PASSED);
  expect(await check(page, "none", [])).toEqual(PASSED);
});

test("VER-03, VER-07: a chart whose total misses the new entry fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  const result = await check(page, "staleTotal");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toBe(
    `The chart check, a rule of Tessera's (total shows the sum of the entries' numbers.): expected a total of 2007.5 for the 5 entries the chart shows; observed "$1,970.00".`,
  );
});

test("VER-03: a chart that isn't drawn again after adding fails", async ({ page }) => {
  const result = await check(page, "staleChart");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /expected the chart showing "Tessera check entry [0-9a-f]{6}" once after adding it; observed it not shown; the labels "Rent", "Food", "Transport", "Fun"\.$/,
  );
});

test("VER-03: a chart that doesn't show the number typed fails", async ({ page }) => {
  const result = await check(page, "rounded");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /\(The chart in chart has one series, with a label and a value for each entry: its name and its number\.\): expected "Tessera check entry [0-9a-f]{6}" at 37\.5, the number typed; observed 38\.$/,
  );
});

test("VER-03: a chart that shows an entry without saving it fails once opened again", async ({
  page,
}) => {
  const result = await check(page, "notSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows the entries as they were saved.)");
  expect(result.reason).toMatch(
    /observed 4 entries; gone: "Tessera check entry [0-9a-f]{6}: 37\.5"; none new\.$/,
  );
});

test("VER-03, VER-04: a chart with more than the one series the prompt asked for fails", async ({
  page,
}) => {
  const result = await check(page, "twoSeries");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("expected a chart with one series; observed 2 series.");
});

const NUMBERED = SPENT.map((entry, i) => ({ ...entry, name: `${i + 1}. ${entry.name}` }));

test("VER-03: a chart's names are compared exactly, so one that renumbers the other entries as it adds fails", async ({
  page,
}) => {
  const result = await check(page, "renumbers", NUMBERED);
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("expected the other 4 entries as they were after adding");
  expect(result.reason).toContain('observed gone: "1. Rent: 1200", "2. Food: 450"');
});

test("VER-03: and one whose saved names come back renumbered fails once opened again", async ({
  page,
}) => {
  const result = await check(page, "savesRenumbered", NUMBERED);
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows the entries as they were saved.)");
  expect(result.reason).toContain('gone: "1. Rent: 1200"');
});
