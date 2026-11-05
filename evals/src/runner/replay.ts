// Docs: docs/code/evals/runner.md
// Plays a scenario from an answers file (a rehearsal or a recorded live run), with no call
// (EVAL-07): the command's rehearsal and replay modes, and the tests that replay recorded runs.
import type { Browser } from "@playwright/test";
import { listSavedTools, type Store } from "@tessera/server";
import type { Scenario } from "../scenarios/index.ts";
import { runScenario, type RunReport } from "./run.ts";
import { answersProvider, loadAnswers } from "./script.ts";

/** Plays `scenario` from the answers in `file`, which must be for it; makes no call. */
export async function replayScenario(
  scenario: Scenario,
  options: {
    mode: "rehearsal" | "replay";
    file: string;
    folder: string;
    webRoot?: string;
    launchBrowser?: () => Promise<Browser>;
  },
): Promise<RunReport> {
  const loaded = loadAnswers(options.file);
  if (loaded.scenario !== scenario.id) {
    throw new Error(`The answers are for ${loaded.scenario}, not ${scenario.id}.`);
  }
  let store: Store | undefined;
  // The saved tools a recorded answer names are looked up in the run's own Tessera.
  const answers = answersProvider(
    loaded,
    (name) => store && listSavedTools(store).find((t) => t.name === name)?.id,
  );
  return runScenario(scenario, {
    mode: options.mode,
    provider: answers,
    folder: options.folder,
    onStarted: (started) => (store = started),
    misfits: () => answers.misfits(),
    stale: () => answers.stale(),
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
    ...(options.launchBrowser ? { launchBrowser: options.launchBrowser } : {}),
  });
}
