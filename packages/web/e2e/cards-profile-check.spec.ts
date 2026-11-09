import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The cards profile's behavior check (VER-03), in Chrome and Edge (TEST-06): in staging, after the
// smoke check, it reads the cards, pastes notes of its own, one card a line, and expects exactly
// the cards they give more, each front with its back, and the others as they were, then opens the
// tool again, its saves going to a throwaway copy (BRG-06). A good tool passes; each deliberately
// broken one fails, saying what was expected, what was observed and whose rule it is (VER-07).

type Flaw = "none" | "lastColon" | "keepsHeadings" | "replaces" | "notSaved" | "hiddenBack";

/** A flashcard tool that fits the cards profile, with `flaw` built in. */
const flashcards = (flaw: Flaw): Artifact["code"] => ({
  html: `<label for="notes">Notes</label> <textarea id="notes" data-hook="notes"></textarea>
<button data-hook="cards-make">Make cards</button>
<ul id="cards"></ul>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
const render = () => {
  document.getElementById("cards").replaceChildren(...state.data.cards.map((card) => {
    const item = document.createElement("li");
    item.dataset.hook = "card";
    const front = document.createElement("strong");
    front.dataset.hook = "card-front";
    front.textContent = card.front;
    const back = document.createElement("span");
    back.dataset.hook = "card-back";
    back.textContent = card.back;
    // One flaw keeps each back hidden until its card is pressed.
    if (flaw === "hiddenBack") {
      back.hidden = true;
      item.addEventListener("click", () => { back.hidden = false; });
    }
    item.append(front, " ", back);
    return item;
  }));
};
const load = () => tessera.call("data.read").then((read) => { state = read; render(); });
load();
// One card a line: the front before the colon, the back after it. One flaw splits at the last
// colon, one makes a card from a line with nothing after its colon.
const cardsOf = (notes) => notes.split(String.fromCharCode(10)).flatMap((line) => {
  const at = flaw === "lastColon" ? line.lastIndexOf(":") : line.indexOf(":");
  if (at < 0) return [];
  const front = line.slice(0, at).trim();
  const back = line.slice(at + 1).trim();
  if (!front || (!back && flaw !== "keepsHeadings")) return [];
  return [{ front, back }];
});
document.querySelector("[data-hook=cards-make]").addEventListener("click", () => {
  const made = cardsOf(document.querySelector("[data-hook=notes]").value);
  if (flaw === "notSaved") {
    state.data.cards.push(...made.map((card, i) => ({ id: "made-" + i, ...card })));
    return render();
  }
  // One flaw puts the new cards in place of those already made.
  const removes = flaw === "replaces"
    ? state.data.cards.map((card) => ({ op: "remove", collection: "cards", id: card.id, revisionCount: state.revisions.cards[card.id] }))
    : [];
  const adds = made.map((record) => ({ op: "add", collection: "cards", record }));
  tessera.call("data.patch", { operations: [...removes, ...adds] }).then(load);
});`,
});

const flaws: Flaw[] = ["none", "lastColon", "keepsHeadings", "replaces", "notSaved", "hiddenBack"];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, flashcards(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

const MADE = [
  { front: "Mitochondria", back: "Where the cell makes its energy" },
  { front: "Osmosis", back: "Water moving through a membrane" },
];

/** Stages a tool behind the smoke check and the cards check; activation is refused. */
async function check(page: Page, flaw: Flaw, cards = MADE): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, cards }) => {
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
          syntheticData: { cards: cards.map((card, i) => ({ id: `c-${i + 1}`, ...card })) },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("cards")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, cards },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("VER-03: flashcards made one a line from pasted notes, and kept, pass the cards check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does a tool that starts with no cards", async ({ page }) => {
  expect(await check(page, "none", [])).toEqual(PASSED);
});

test("VER-03, VER-07: a tool that splits a line at its last colon fails, saying what was expected and observed, by whose rule", async ({
  page,
}) => {
  const result = await check(page, "lastColon");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /^The cards check, a rule of Tessera's \(Pressing cards-make makes one card for each line .*\): expected 2 cards more from the notes the check pasted, .*"Tessera check term [0-9a-f]{6} 2: at 10:30, [^"]*"; observed 2 cards more; missing: "Tessera check term [0-9a-f]{6} 2: at 10:30, [^"]*"; others: "Tessera check term [0-9a-f]{6} 2: at 10: 30, [^"]*"\.$/,
  );
});

test("VER-03: a tool that makes a card from a heading with nothing after its colon fails", async ({
  page,
}) => {
  const result = await check(page, "keepsHeadings");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toMatch(
    /observed 3 cards more; none missing; others: "Tessera check heading [0-9a-f]{6}: "\.$/,
  );
});

test("VER-03: a tool that puts new cards in place of those already made fails", async ({
  page,
}) => {
  const result = await check(page, "replaces");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    'expected the 2 cards already made as they were after making cards; observed gone: "Mitochondria: Where the cell makes its energy", "Osmosis: Water moving through a membrane".',
  );
});

test("VER-03: a tool that shows cards without saving them fails once opened again", async ({
  page,
}) => {
  const result = await check(page, "notSaved");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("(Opened again, the tool shows the cards as they were saved.)");
  expect(result.reason).toMatch(
    /expected the 4 cards it showed, after opening the tool again; observed 2 cards; gone: .*; none new\.$/,
  );
});

test("VER-03, VER-04: a tool that hides each card's back, where the prompt asked for it shown, fails", async ({
  page,
}) => {
  const result = await check(page, "hiddenBack");
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain(
    "expected a card-front and a card-back shown in each of the 2 cards; observed 2 card-front and 0 card-back shown.",
  );
});
