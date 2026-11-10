import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Artifact } from "@tessera/contracts";
import {
  activateVersion,
  createScriptedProvider,
  createWorkspace,
  openDataFolder,
  saveVersion,
} from "@tessera/server";
import { afterAll, describe, expect, it } from "vitest";
import { readLedger, readRequestLog } from "../src/harness/index.ts";
import {
  chooseScreenshots,
  rehearsalReview,
  REVIEW_FILE,
  REVIEW_HARNESS,
  reviewMarkdown,
  reviewRun,
} from "../src/review/review.ts";
import { loadScenario } from "../src/scenarios/index.ts";

// The AI technical review of a recorded run (EVAL-03, EVAL-04, A27), rehearsed: a small run folder
// as the scenario runner leaves one, reviewed through the harness with canned answers. No model.

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A 1×1 PNG, as the runner's screenshots are PNGs.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const tool: Artifact = {
  contractVersion: 2,
  code: { html: '<form data-hook="form">Party RSVP</form>', css: "", js: "// the form" },
  data: { schemaVersion: 1, schema: {}, defaults: {}, migrations: [] },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

/** A finished T5 run: two steps, the second blocked; one screenshot; one tool version. */
async function run(): Promise<string> {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-review-test-"));
  temps.push(folder);
  const report = {
    scenario: "T5-rsvp-form",
    mode: "live",
    steps: [
      {
        index: 1,
        kind: "say",
        action: "say: Make a form for my party guests",
        outcome: "passed",
        notice: "Party guest form is ready.\nA form for each guest.",
        problems: [],
        seconds: 30,
        screenshot: "tool",
      },
      {
        index: 2,
        kind: "do",
        action: 'do: {"click":"form-submit"}',
        outcome: "blocked",
        notice: "",
        problems: [],
        seconds: 0,
      },
    ],
  };
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(report));
  fs.writeFileSync(path.join(folder, "report.md"), "# T5-rsvp-form: live\n");
  fs.writeFileSync(path.join(folder, "step-1.png"), PNG);
  const store = await openDataFolder(path.join(folder, "tessera"));
  try {
    const { id } = createWorkspace(store, "Party guest form");
    const done = activateVersion(store, id, saveVersion(store.db, tool), 0);
    if (!done.ok) throw new Error(done.message);
  } finally {
    store.close();
  }
  return folder;
}

const items = loadScenario(
  path.resolve(import.meta.dirname, "../scenarios/T5-rsvp-form.yaml"),
).review;

describe("reviewing a recorded run (EVAL-03, A27)", () => {
  it("EVAL-03, A27: sends the run quoted as data and its screenshots as images, once, through the harness, and keeps the review with the run", async () => {
    const folder = await run();
    const record = await reviewRun(folder, { mode: "rehearsal" });
    expect(record.images).toEqual(["step-1.png"]);
    expect(record.imagesLeftOut).toEqual([]);
    expect(record.review).toEqual(rehearsalReview(items));
    expect(record.ownerVerdict).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(folder, REVIEW_FILE), "utf8"))).toEqual(record);
    // One call, the review's, recorded by the harness in the review's own folder (ENG-07).
    const ledger = readLedger(path.join(folder, REVIEW_HARNESS));
    expect(ledger.map((e) => [e.stage, e.outcome.kind])).toEqual([["review", "ok"]]);
    const [request] = readRequestLog(path.join(folder, REVIEW_HARNESS));
    // The tool's source and the host's message are quoted as data; a blocked step is named, with
    // no screenshot.
    expect(request!.prompt).toContain("--- run ---");
    expect(request!.prompt).toContain('<form data-hook=\\"form\\">Party RSVP</form>');
    expect(request!.prompt).toContain("Party guest form is ready.");
    expect(request!.prompt).toContain(
      "The screenshots are attached as images, in this order: step-1.png.",
    );
    expect(request!.prompt).toContain('"outcome": "blocked"');
  });

  it("A27: with a provider that can't pass images, reviews without them and says why", async () => {
    const folder = await run();
    const provider = {
      ...createScriptedProvider({
        name: "no-images",
        replies: [{ kind: "value", stage: "review", value: rehearsalReview(items) }],
      }),
      acceptsImages: false,
    };
    const record = await reviewRun(folder, { mode: "rehearsal", provider });
    expect(record.images).toEqual([]);
    expect(record.imagesLeftOut).toEqual(["scripted:no-images can't pass images to the model"]);
    const [request] = readRequestLog(path.join(folder, REVIEW_HARNESS));
    expect(request!.prompt).toContain(
      "No screenshots are attached: scripted:no-images can't pass images to the model.",
    );
  });

  it("EVAL-03: an answer that leaves out an item asked fails the review, and nothing is kept", async () => {
    const folder = await run();
    const provider = createScriptedProvider({
      name: "incomplete",
      replies: [
        {
          kind: "value",
          stage: "review",
          value: { ...rehearsalReview(items), items: rehearsalReview(items).items.slice(1) },
        },
      ],
    });
    await expect(reviewRun(folder, { mode: "rehearsal", provider })).rejects.toThrow();
    expect(fs.existsSync(path.join(folder, REVIEW_FILE))).toBe(false);
  });

  it("ENG-07: a live review refuses a provider that can't reach a model", async () => {
    const folder = await run();
    const provider = createScriptedProvider({ name: "canned", replies: [] });
    await expect(reviewRun(folder, { mode: "live", provider, callCap: 1 })).rejects.toThrow();
  });
});

describe("the review in the report (EVAL-04)", () => {
  it("EVAL-04: shows each item's mark and evidence, the advised verdict and a line for the owner's", () => {
    const markdown = reviewMarkdown({
      scenario: "T5-rsvp-form",
      mode: "live",
      provider: "claude",
      reviewedAt: "2026-11-10T00:00:00.000Z",
      images: ["step-1.png"],
      imagesLeftOut: [],
      review: {
        items: [{ item: "fulfilment", mark: "partly", evidence: ["step 1 | the form"] }],
        verdict: "accept-with-notes",
        notes: ["The empty send wasn't shown."],
      },
      ownerVerdict: null,
    });
    expect(markdown).toContain("| fulfilment | partly | step 1 \\| the form |");
    expect(markdown).toContain("**Advised verdict:** accept with notes.");
    expect(markdown).toContain("- The empty send wasn't shown.");
    expect(markdown).toContain(
      "**Owner's verdict (EVAL-04):** not given yet: accept, accept with notes, or reject.",
    );
  });

  it("A27: sends every screenshot that fits the limit, else the first, the last and the rest spread between", () => {
    const shots = Array.from({ length: 20 }, (_, i) => i + 1);
    const chosen = chooseScreenshots(shots);
    expect(chosen).toHaveLength(12);
    expect(chosen[0]).toBe(1);
    expect(chosen.at(-1)).toBe(20);
    expect(new Set(chosen).size).toBe(12);
    expect(chooseScreenshots([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
