// Docs: docs/code/evals/runner.md
// Every approved live run's recorded answers, replayed through the real pipeline and the host app
// with no call (EVAL-07, TEST-04): the scenario runner plays each file in
// evals/scenarios/replays/ and the report must match the live run's, step for step. An answer
// that stops fitting the pipeline (a misfit) fails its step, so it fails here. One recorded with
// other prompt parts still runs and is only listed in the report as stale (ENG-16), which this
// doesn't check. Chrome at 1280 px only: the runner starts its own Chrome.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loadScenario } from "../../../evals/src/scenarios/index.ts";
import { replayScenario } from "../../../evals/src/runner/replay.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../../evals/scenarios");
const replays = path.join(scenarios, "replays");

// The steps each recorded run fails against today's scenario files; every other step passes. The
// M2 run's two failures were the scenario's expectation, not the model, and the files were
// corrected after it (T1 step 2 expects its data kept, T13 step 3 no new version), so they pass
// now. The run's score stays as its report froze it (evals/reports/2026-11-05-m2-live-run.md).
const failedLive: Record<string, [step: number, problems: string[]][]> = {
  "J6-limits": [],
  "T1-shopping-list": [],
  "T6-tip-calculator": [],
  "T13-drawing-board": [],
};

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
      webRoot: path.resolve(here, "../dist"),
    });
    expect(report.stopped).toBeFalsy();
    expect(
      report.steps.filter((s) => s.outcome !== "passed").map((s) => [s.index, s.problems]),
    ).toEqual(failed);
  });
}
