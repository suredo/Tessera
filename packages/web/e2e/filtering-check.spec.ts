import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The filtering profile's behavior check (VER-03), in Chrome (TEST-06): in staging, after
// the smoke check, the item list's check, adding the item in a category of its own, and, with it
// added and the tool opened again, the filter set to that category, to one a starting item has,
// then emptied, its saves going to a throwaway copy (BRG-06). A good list passes, whether its
// filter is a select or a field and whether it hides items or leaves them out; each deliberately
// broken one fails, saying what was expected, what was observed and whose rule it is (VER-07).

type Flaw =
  | "none"
  | "field"
  | "ignoresFilter"
  | "firstOnly"
  | "noAllChoice"
  | "keepsFilter"
  | "dropsCategory"
  | "fieldDropsCategory"
  | "duplicates"
  | "exactSpaces";

/** A reading list that fits the filtering profile, with `flaw` built in. */
const list = (flaw: Flaw): Artifact["code"] => {
  const field = flaw === "field" || flaw === "fieldDropsCategory" || flaw === "exactSpaces";
  return {
    html: `<label for="name">Book</label> <input id="name" data-hook="item-name">
<label for="genre">Genre</label> <input id="genre" data-hook="item-category">
<button data-hook="item-add">Add</button>
<label for="filter">Show</label> ${field ? '<input id="filter" data-hook="filter">' : '<select id="filter" data-hook="filter"></select>'}
<ul></ul>`,
    css: "",
    js: `const flaw = ${JSON.stringify(flaw)};
const field = ${JSON.stringify(field)};
let state;
let last = "";
const list = document.querySelector("ul");
const filter = document.querySelector("[data-hook=filter]");
const render = () => {
  const books = state.data.items;
  if (!field) {
    const chosen = filter.value;
    const genres = [...new Set(books.map((book) => book.genre))];
    filter.replaceChildren(
      new Option("All", flaw === "noAllChoice" ? "all" : ""),
      ...genres.map((genre) => new Option(genre, genre)),
    );
    filter.value = chosen;
  }
  let chosen = flaw === "noAllChoice" && filter.value === "all" ? "" : filter.value;
  // One flaw keeps the last category chosen once the filter is emptied.
  if (flaw === "keepsFilter") {
    if (chosen) last = chosen;
    else chosen = last;
  }
  // A category as the rule compares it; one flaw compares the text as stored.
  const spaced = (text) => flaw === "exactSpaces" ? text : text.trim().split(" ").filter(Boolean).join(" ");
  let shown = 0;
  let first;
  list.replaceChildren(...books.flatMap((record) => {
    const fits = flaw === "ignoresFilter" || !chosen || spaced(record.genre) === spaced(chosen);
    if (fits && flaw === "firstOnly" && chosen && shown > 0) return [];
    if (fits) shown += 1;
    // The field-filtered list leaves out what it filters; the others hide it.
    if (!fits && field) return [];
    // One flaw shows the first item in the category in place of every other one.
    if (fits && chosen) first ??= record;
    const book = flaw === "duplicates" && fits && chosen ? first : record;
    const item = document.createElement("li");
    item.dataset.hook = "item";
    item.hidden = !fits;
    const genre = document.createElement("span");
    genre.dataset.hook = "category";
    genre.textContent = book.genre;
    item.append(book.name + " ", genre, " ");
    const remove = document.createElement("button");
    remove.dataset.hook = "item-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () =>
      tessera
        .call("data.patch", { operations: [{ op: "remove", collection: "items", id: record.id, revisionCount: state.revisions.items[record.id] }] })
        .then(load),
    );
    item.append(remove);
    return [item];
  }));
};
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
filter.addEventListener(field ? "input" : "change", render);
document.querySelector("[data-hook=item-add]").addEventListener("click", () => {
  const name = document.querySelector("[data-hook=item-name]").value;
  const typed = document.querySelector("[data-hook=item-category]").value;
  const genre = flaw === "dropsCategory" || flaw === "fieldDropsCategory" ? "Unsorted" : typed;
  tessera.call("data.patch", { operations: [{ op: "add", collection: "items", record: { name, genre } }] }).then(load);
});`,
  };
};

const flaws: Flaw[] = [
  "none",
  "field",
  "ignoresFilter",
  "firstOnly",
  "noAllChoice",
  "keepsFilter",
  "dropsCategory",
  "fieldDropsCategory",
  "duplicates",
  "exactSpaces",
];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, list(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

const BOOKS = [
  { name: "Dune", genre: "Fiction" },
  { name: "SPQR", genre: "History" },
  { name: "Emma", genre: "Fiction" },
];

/** Stages a list behind the smoke check and the filtering check; activation is refused. */
async function check(page: Page, flaw: Flaw, books = BOOKS): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, books }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        profileCheck(id: string): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: [],
          syntheticData: { items: books.map((book, i) => ({ id: `b-${i + 1}`, ...book })) },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("filtering")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, books },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };
const NARROWS =
  "(Setting filter to a category shows every item whose category is exactly that, spaces at either end aside and repeated spaces counting as one, and hides the rest; emptying it shows every item again.)";

test("VER-03: a list whose select filter hides the items outside a category passes the filtering check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one whose filter is a field that leaves those items out", async ({
  page,
}) => {
  expect(await check(page, "field")).toEqual(PASSED);
});

test("VER-03, VER-07: a list whose filter does nothing fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  const result = await check(page, "ignoresFilter");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(`The filtering check, a rule of Tessera's ${NARROWS}`);
  expect(result.reason).toMatch(
    /expected the 1 item in "Tessera check category [0-9a-f]{6}", and no other, with filter set to it; observed 4 items; none gone; new: "Dune Fiction Remove", "SPQR History Remove", "Emma Fiction Remove"\.$/,
  );
});

test("VER-03: a list whose filter shows only some of a category's items fails", async ({
  page,
}) => {
  const result = await check(page, "firstOnly");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    'expected the 2 items in "Fiction", and no other, with filter set to it; observed 1 item; gone: "Emma Fiction Remove"; none new.',
  );
});

test("VER-03, VER-04: a list whose select has no empty-valued choice for all fails, saying so", async ({
  page,
}) => {
  const result = await check(page, "noAllChoice");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    'observed The select with the hook "filter" has no choice with an empty value.',
  );
});

test("VER-03: a list that stays narrowed once its filter is emptied fails", async ({ page }) => {
  const result = await check(page, "keepsFilter");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /expected all 4 items, as they were, with filter emptied; observed 2 items; gone: "SPQR History Remove", "Tessera check item [0-9a-f]{6} Tessera check category [0-9a-f]{6} Remo"; none new\.$/,
  );
});

test("VER-03: a list that doesn't keep the category typed fails, whatever its filter", async ({
  page,
}) => {
  for (const flaw of ["dropsCategory", "fieldDropsCategory"] as const) {
    const result = await check(page, flaw);
    expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
    expect(result.reason).toMatch(
      /^The filtering check, a rule of Tessera's \(Typing a name in item-name and a category in item-category, then pressing item-add, adds one item with that name and category to the list, and saves it\.\): expected "Tessera check item [0-9a-f]{6}" in the category "Tessera check category [0-9a-f]{6}"; observed it in "Unsorted"\.$/,
    );
  }
});

test("VER-03: a list whose filter shows the right number of items, but not the right ones, fails", async ({
  page,
}) => {
  const result = await check(page, "duplicates");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    'expected the 2 items in "Fiction", and no other, with filter set to it; observed 2 items; gone: "Emma Fiction Remove"; new: "Dune Fiction Remove".',
  );
});

test("VER-03, VER-04: categories are their text exactly, as the prompt says, so ones differing only in case are kept apart", async ({
  page,
}) => {
  expect(await check(page, "none", [...BOOKS, { name: "Ulysses", genre: "fiction" }])).toEqual(
    PASSED,
  );
});

test("VER-03, VER-04: spaces at a category's ends, or repeated, don't make it another, as the prompt says", async ({
  page,
}) => {
  const spaced = [...BOOKS, { name: "Ulysses", genre: " Fiction " }];
  expect(await check(page, "field", spaced)).toEqual(PASSED);
  const result = await check(page, "exactSpaces", spaced);
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    'expected the 3 items in "Fiction", and no other, with filter set to it; observed 2 items; gone: "Ulysses Fiction Remove"; none new.',
  );
});
