import { expect, test, type Page } from "@playwright/test";
import type { Artifact } from "../../contracts/src/index.ts";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";
import { ready } from "./support/ready.ts";

// The smoke check (VER-02), in Chrome and Edge (TEST-06): a candidate starts for real in the
// hidden staging panel, 320 px wide, against synthetic data (RUN-03), and must show something,
// start without errors, not scroll sideways, and meet the accessibility floor's basics. A failing
// candidate is never activated; its reason lists every problem, for repair (GEN-09).

const tools: Record<string, Artifact["code"]> = {
  // Reads its data, then shows it, labelled and named: passes once its call has settled.
  good: {
    html: '<h1>Errands</h1><label for="task">New task</label> <input id="task"> <button id="add">Add</button><ul id="list"></ul>',
    css: "",
    js: `tessera.call("data.read").then(({ data }) => {
  for (const task of data.tasks) {
    const item = document.createElement("li");
    item.textContent = task.title;
    document.getElementById("list").append(item);
  }
});`,
  },
  throws: { html: "<p>Hi</p>", css: "", js: 'throw new Error("boom");' },
  rejects: { html: "<p>Hi</p>", css: "", js: 'Promise.reject(new Error("later"));' },
  empty: { html: "", css: "", js: "" },
  wide: { html: '<div class="wide">A very wide box</div>', css: ".wide { width: 600px; }", js: "" },
  unlabelled: {
    html: '<p>Notes</p><input id="note"><button></button><canvas aria-label="Drawing"></canvas>',
    css: "",
    js: "",
  },
  blocked: {
    html: "<p>Prices</p>",
    css: "",
    js: 'fetch("https://example.com/prices").catch(() => {});',
  },
};

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost(tools);
});
test.afterAll(() => host.close());

type Result = { outcome: string; check?: string; reason?: string; message?: string };

/** Stages a candidate with only the smoke check; activation is refused, so nothing is stored. */
async function smoke(page: Page, mountId: string): Promise<Result> {
  await page.goto(host.url);
  await ready(page, "stageCandidate");
  return page.evaluate(async (mountId) => {
    const w = window as unknown as {
      stageCandidate(options: unknown): Promise<Result>;
      smokeCheck(): unknown;
    };
    return w.stageCandidate({
      candidate: {
        mountId,
        hash: "a".repeat(64),
        capabilities: [],
        syntheticData: { tasks: [{ id: "d-1", title: "A starting task" }] },
      },
      workspaceId: "00000000-0000-4000-8000-000000000000",
      expectedDataRevision: 0,
      checks: [w.smokeCheck()],
      // Reached only when every check passed; refusing keeps the test off the server.
      activate: () =>
        Promise.resolve({ ok: false, reason: "stale", message: "Passed the checks." }),
    });
  }, mountId);
}

test("VER-02: a tool that shows its data, labelled and named, passes once its calls settle", async ({
  page,
}) => {
  expect(await smoke(page, "good")).toEqual({
    outcome: "refused",
    reason: "stale",
    message: "Passed the checks.",
  });
});

test("VER-02: an error or an unhandled rejection as the tool starts fails it", async ({ page }) => {
  const thrown = await smoke(page, "throws");
  expect(thrown).toMatchObject({ outcome: "check-failed", check: "smoke" });
  expect(thrown.reason).toContain("boom");
  const rejected = await smoke(page, "rejects");
  expect(rejected).toMatchObject({ outcome: "check-failed", check: "smoke" });
  expect(rejected.reason).toContain("An error nothing handled: later");
});

test("VER-02: a tool that shows nothing fails", async ({ page }) => {
  expect(await smoke(page, "empty")).toEqual({
    outcome: "check-failed",
    check: "smoke",
    reason: "The tool shows nothing.",
  });
});

test("VER-02: a tool that scrolls sideways at 320 px fails, saying by how much", async ({
  page,
}) => {
  const result = await smoke(page, "wide");
  expect(result).toMatchObject({ outcome: "check-failed", check: "smoke" });
  expect(result.reason).toMatch(/^At 320 px wide, the tool scrolls sideways by \d+ px\.$/);
});

test("VER-02: the accessibility floor: a field without a label and a button without a name fail it", async ({
  page,
}) => {
  expect(await smoke(page, "unlabelled")).toEqual({
    outcome: "check-failed",
    check: "smoke",
    reason: "1 field has no label. 1 button has no name.",
  });
});

test("VER-02: something the tool tried that the sandbox blocked fails it", async ({ page }) => {
  const result = await smoke(page, "blocked");
  expect(result).toMatchObject({ outcome: "check-failed", check: "smoke" });
  expect(result.reason).toContain("Something the tool tried was blocked (connect-src).");
});
