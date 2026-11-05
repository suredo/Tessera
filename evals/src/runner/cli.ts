// Docs: docs/code/evals/runner.md
// Plays a scenario without a model: node evals/src/runner/cli.ts <scenario-id> [--replay <file>]
// The default is its rehearsal, evals/scenarios/rehearsals/<id>.json. Build first: pnpm build.
// A live run comes with the M2 live evaluation and its own approved budget (ENG-07).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSavedTools, type Store } from "@tessera/server";
import { loadScenario } from "../scenarios/index.ts";
import { reportMarkdown } from "./report.ts";
import { runScenario } from "./run.ts";
import { answersProvider, loadAnswers } from "./script.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../scenarios");
const [id, flag, file] = process.argv.slice(2);
if (!id || (flag && flag !== "--replay") || (flag === "--replay" && !file)) {
  console.error("Usage: node evals/src/runner/cli.ts <scenario-id> [--replay <answers file>]");
  process.exit(2);
}
const scenario = loadScenario(path.join(scenarios, `${id}.yaml`));
const mode = flag === "--replay" ? "replay" : "rehearsal";
const answers = loadAnswers(file ?? path.join(scenarios, "rehearsals", `${id}.json`));
if (answers.scenario !== scenario.id) {
  throw new Error(`The answers are for ${answers.scenario}, not ${scenario.id}.`);
}
const folder = path.resolve(
  here,
  "../../../test-output/evals/scenarios",
  `${scenario.id}-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
fs.mkdirSync(folder, { recursive: true });
// The saved tools a recorded answer names are looked up in the run's own Tessera.
let store: Store | undefined;
const provider = answersProvider(
  answers,
  (name) => store && listSavedTools(store).find((t) => t.name === name)?.id,
);
const report = await runScenario(scenario, {
  mode,
  provider,
  folder,
  onStarted: (started) => (store = started),
});
fs.writeFileSync(path.join(folder, "report.md"), reportMarkdown(report));
console.log(reportMarkdown(report));
console.log(`Evidence: ${folder}`);
process.exitCode = report.steps.every((s) => s.outcome === "passed") && !report.stopped ? 0 : 1;
