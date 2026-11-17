// Docs: docs/code/evals/runner.md
// Every approved live run's recorded answers, replayed through the real pipeline and the host app
// with no call (EVAL-07, TEST-04): the scenario runner plays each file in
// evals/scenarios/replays/ and the report must match the live run's, step for step. An answer
// that stops fitting the pipeline (a misfit) fails its step, so it fails here. One recorded with
// other prompt parts still runs and is only listed in the report as stale (ENG-16), which this
// doesn't check. Chrome at 1280 px only: the runner starts its own Chrome.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loadScenario } from "../../../evals/src/scenarios/index.ts";
import { replayScenario } from "../../../evals/src/runner/replay.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../../evals/scenarios");
const replays = path.join(scenarios, "replays");

// The steps each recorded run fails against today's scenario files; every other step passes. J6
// is the M2 live run's recording (evals/reports/2026-11-05-m2-live-run.md); T6 and V9 are M3's
// (evals/reports/2026-11-09-m3-live-run.md, evals/reports/2026-11-10-acceptance-run.md). The
// rest are M4's (evals/reports/2026-11-17-m4-live-run.md), each failing as it did live; T3, T10
// in Portuguese, T12 and T14 are their reruns after L-103 and L-104: T12's board was made as a
// planner, with none of its steps' hooks and no way to mark a chore done, and T14 marked two
// buttons as the edit. A run whose first step failed is listed in stoppedLive, with every later
// step blocked.
const failedLive: Record<string, [step: number, problems: string[]][]> = {
  "J6-limits": [],
  "T1-shopping-list": [],
  "T2-reading-list": [],
  "T3-spending-chart": [],
  "T4-habit-tracker": [],
  "T5-rsvp-form": [],
  "T6-tip-calculator": [],
  "T7-movie-finder": [],
  "T10-study-planner": [],
  "T10-study-planner-pt": [],
  "T11-tutor-bookings": [],
  "T12-family-chores": [
    [2, ["The tool shows 0 elements marked item-name; the step needs one."]],
    [3, ["The tool shows 0 elements marked item-category; the step needs one."]],
    [4, ["The tool shows 0 elements marked item-add; the step needs one."]],
    [5, ["The tool shows 0 elements marked filter; the step needs one."]],
    [7, ["The data didn't change."]],
  ],
  "T13-drawing-board": [],
  "T14-image-editor": [[3, ["The tool shows 2 elements marked image-edit; the step needs one."]]],
  "V9-acceptance-checks": [],
};
// The recorded runs whose first step failed, so the runner stopped there (the stop rule).
const stoppedLive = new Set<string>();

test("EVAL-07: every recorded live run has its expected steps listed here", () => {
  const recorded = fs.readdirSync(replays).map((f) => path.basename(f, ".json"));
  expect(recorded.sort()).toEqual(Object.keys(failedLive).sort());
});

for (const [id, failed] of Object.entries(failedLive)) {
  test(`EVAL-07, TEST-04: ${id}'s live run replays as it ran, with no call`, async () => {
    const info = test.info();
    test.skip(info.project.name !== "chrome-1280", "The runner starts its own Chrome.");
    test.setTimeout(240_000);
    const report = await replayScenario(loadScenario(path.join(scenarios, `${id}.yaml`)), {
      mode: "replay",
      file: path.join(replays, `${id}.json`),
      folder: info.outputPath("scenario"),
      // A video only when asked, as for every browser test (A56).
      recordVideo: process.env["TESSERA_E2E_RECORD"] === "1",
      webRoot: path.resolve(here, "../dist"),
    });
    const stopped = stoppedLive.has(id);
    expect(Boolean(report.stopped)).toBe(stopped);
    expect(
      report.steps.filter((s) => s.outcome === "failed").map((s) => [s.index, s.problems]),
    ).toEqual(failed);
    // Only a stopped run has blocked steps: every step after its first.
    expect(report.steps.filter((s) => s.outcome === "blocked").map((s) => s.index)).toEqual(
      stopped ? report.steps.slice(1).map((s) => s.index) : [],
    );
    // Every screenshot shows the tool whenever one is open, never an empty panel (L-81).
    // A blocked step wasn't played, so it has no screenshot.
    const played = report.steps.filter((s) => s.outcome !== "blocked");
    expect(played.map((s) => [s.index, s.screenshot])).toEqual(
      played.map((s) => [s.index, s.screenshot === "no tool" ? "no tool" : "tool"]),
    );
    if (id === "V9-acceptance-checks") {
      // L-93: the dice roller's one check looked for "Total", which its total showed before Roll
      // was pressed, so it proved nothing and the dice roller isn't checked against the request.
      // Each other tool's checks proved what they say, so it is.
      const db = new DatabaseSync(path.join(info.outputPath("scenario"), "tessera", "tessera.db"), {
        readOnly: true,
      });
      const checks = db
        .prepare("SELECT checks FROM workspace_versions ORDER BY created_at")
        .all()
        .map((row) => JSON.parse(String(row["checks"])) as string[]);
      db.close();
      expect(checks).toEqual([
        ["code", "start", "acceptance"],
        ["code", "start", "acceptance"],
        ["code", "start"],
        ["code", "start", "acceptance"],
      ]);
    }
  });
}
