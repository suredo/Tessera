import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The search-results profile's behavior check (VER-03, #351), in Chrome (TEST-06): in staging,
// after the smoke check, it searches, its results coming from the tool's own sample answers (A69),
// keeps a result, keeps it again, and opens the tool again, its saves going to a throwaway copy
// (BRG-06). A good tool passes; each deliberately broken one fails, saying what was expected, what
// was observed and whose rule it is (VER-07).

type Flaw = "none" | "noResults" | "keepsTwice" | "notSaved" | "otherTitle" | "changesLong";

/** A film finder that fits the search-results profile, with `flaw` built in. */
const finder = (flaw: Flaw): Artifact["code"] => ({
  html: `<label for="q">Search</label> <input id="q" data-hook="search-query">
<button type="button" data-hook="search-go">Search</button>
<ul id="results"></ul>
<h2>Kept</h2>
<ul id="kept"></ul>`,
  css: "",
  js: `const flaw = ${JSON.stringify(flaw)};
let state;
const showKept = (fresh) => {
  document.getElementById("kept").replaceChildren(...state.data.kept.map((film) => {
    const item = document.createElement("li");
    item.dataset.hook = "kept";
    const changes = flaw === "changesLong" && fresh && state.data.kept.length > 1 && film.title.length > 200;
    item.textContent = changes ? film.title.replace("original", "WRONG") : film.title;
    return item;
  }));
};
const load = (fresh) => tessera.call("data.read").then((read) => { state = read; showKept(fresh === true); });
load(true);
const keep = (film) => {
  // One flaw keeps a film again; one keeps it only on screen; one keeps it under another name.
  if (flaw !== "keepsTwice" && state.data.kept.some((kept) => kept.title === film.title)) return;
  const title = flaw === "otherTitle" ? film.title.toUpperCase() : film.title;
  if (flaw === "notSaved") {
    state.data.kept.push({ id: "k-" + state.data.kept.length, title });
    return showKept();
  }
  tessera.call("data.patch", { operations: [{ op: "add", collection: "kept", record: { title } }] }).then(load);
};
document.querySelector("[data-hook=search-go]").addEventListener("click", () => {
  const query = document.querySelector("[data-hook=search-query]").value;
  tessera.call("connection.request", { connection: "movies", method: "GET", path: "/search?query=" + encodeURIComponent(query) }).then((answer) => {
    // One flaw shows none of the results.
    const films = flaw === "noResults" ? [] : JSON.parse(answer.body).results;
    document.getElementById("results").replaceChildren(...films.map((film) => {
      const item = document.createElement("li");
      item.dataset.hook = "result";
      const title = document.createElement("span");
      title.dataset.hook = "result-title";
      title.textContent = film.title;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.hook = "result-keep";
      button.textContent = "Keep " + film.title;
      button.addEventListener("click", () => keep(film));
      item.append(title, " ", button);
      return item;
    }));
  });
});`,
});

const flaws: Flaw[] = ["none", "noResults", "keepsTwice", "notSaved", "otherTitle", "changesLong"];
let host: SandboxHost;

test.beforeAll(async () => {
  host = await startSandboxHost(Object.fromEntries(flaws.map((flaw) => [flaw, finder(flaw)])));
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string };

/** The sample answers the candidate carries: what its search gets while it is checked (A69). */
const SAMPLES = {
  movies: {
    samples: {
      "/search": {
        statusCode: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [{ title: "Alien" }, { title: "Heat" }] }),
      },
    },
  },
};

/** Stages a tool behind the smoke check and the search-results check; activation is refused. */
async function check(page: Page, flaw: Flaw, kept: string[] = []): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(
    async ({ mountId, kept, samples }) => {
      const w = window as unknown as {
        stageCandidate(options: unknown): Promise<Result>;
        smokeCheck(): unknown;
        profileCheck(id: string): unknown;
      };
      return w.stageCandidate({
        candidate: {
          mountId,
          hash: "a".repeat(64),
          capabilities: ["connection"],
          connections: samples,
          syntheticData: { kept: kept.map((title, i) => ({ id: `k-${i + 1}`, title })) },
        },
        workspaceId: "00000000-0000-4000-8000-000000000000",
        expectedDataRevision: 0,
        activationToken: "00000000-0000-4000-8000-000000000001",
        checks: [w.smokeCheck(), w.profileCheck("search-results")],
        // Reached only when every check passed; refusing keeps the test off the server.
        activate: () =>
          Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
      });
    },
    { mountId: flaw, kept, samples: SAMPLES },
  );
}

const PASSED = { outcome: "refused", reason: "stale", message: "Passed the checks." };

test("VER-03: a finder that shows its results and keeps one, once, saved, passes the search-results check", async ({
  page,
}) => {
  expect(await check(page, "none")).toEqual(PASSED);
});

test("VER-03: so does one that already keeps a result, keeping another", async ({ page }) => {
  expect(await check(page, "none", ["Alien"])).toEqual(PASSED);
});

test("VER-03: so does one that already keeps every result its search gives (#373 review)", async ({
  page,
}) => {
  expect(await check(page, "none", ["Alien", "Heat"])).toEqual(PASSED);
});

test("VER-03: so does one keeping results whose titles are part of others kept (#373 review)", async ({
  page,
}) => {
  expect(await check(page, "none", ["Aliens", "Heatwave"])).toEqual(PASSED);
});

test("VER-03, VER-07: a finder that changes a kept title past what a read shows of it, opened again, fails (#373 review)", async ({
  page,
}) => {
  const long = `${"A long title ".repeat(20)}original ending`;
  const result = await check(page, "changesLong", [long]);
  expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
  expect(result.reason).toContain("Opened again, the tool shows what was kept as it was saved.");
  expect(result.reason).toMatch(/as they were, after opening the tool again/);
});

for (const [flaw, rule, words] of [
  ["noResults", "shows the results of that search", /at least one result after searching/],
  [
    "keepsTwice",
    "keeps nothing more",
    /still 1 result kept, as they were, after keeping "Alien" again; observed 2 results kept; none gone; new: "Alien"/,
  ],
  ["notSaved", "as it was saved", /after opening the tool again/],
  [
    "otherTitle",
    "showing its result-title",
    /one more kept, showing "Alien".*observed new: "ALIEN"/,
  ],
] as const) {
  test(`VER-03, VER-07: a finder that ${flaw === "noResults" ? "shows no results" : flaw === "keepsTwice" ? "keeps a result twice" : flaw === "notSaved" ? "doesn't save what it keeps" : "keeps a result under another title"} fails, saying what was expected and observed, by whose rule`, async ({
    page,
  }) => {
    const result = await check(page, flaw);
    expect(result).toMatchObject({ outcome: "check-failed", check: "behavior" });
    expect(result.reason).toContain("The search-results check, a rule of Tessera's");
    expect(result.reason).toContain(rule);
    expect(result.reason).toMatch(words);
  });
}
