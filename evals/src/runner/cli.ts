// Docs: docs/code/evals/runner.md
// Plays a scenario: node evals/src/runner/cli.ts <scenario-id> [--replay <file> | --live --cap <n>]
// The default is its rehearsal, evals/scenarios/rehearsals/<id>.json. Build first: pnpm build.
// --live is LIVE: it calls Claude Code, so it needs the owner's approved cap first (ENG-07,
// docs/practices/live-evaluation.md, evals/reports/2026-11-05-m2-live-run.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSavedTools, type Provider, type Store } from "@tessera/server";
import { liveClaudeProvider } from "../../spikes/cli-contract/claude-cli.ts";
import { loadScenario } from "../scenarios/index.ts";
import { recordAnswers } from "./record.ts";
import { reportMarkdown } from "./report.ts";
import { runScenario, type RunMode } from "./run.ts";
import { answersProvider, loadAnswers, type AnswersProvider } from "./script.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = path.resolve(here, "../../scenarios");

/** The command's words: a scenario, then nothing, `--replay <file>` or `--live --cap <n>`. */
function parse(args: readonly string[]): {
  id: string;
  mode: RunMode;
  file?: string;
  cap?: number;
} {
  const [id, flag, ...rest] = args;
  if (id && flag === undefined) return { id, mode: "rehearsal" };
  if (id && flag === "--replay" && rest.length === 1) return { id, mode: "replay", file: rest[0]! };
  if (id && flag === "--live" && rest.length === 2 && rest[0] === "--cap") {
    return { id, mode: "live", cap: Number(rest[1]) };
  }
  console.error(
    "Usage: node evals/src/runner/cli.ts <scenario-id> [--replay <answers file> | --live --cap <n>]",
  );
  process.exit(2);
}

const { id, mode, file, cap } = parse(process.argv.slice(2));
const scenario = loadScenario(path.join(scenarios, `${id}.yaml`));
const folder = path.resolve(
  here,
  "../../../test-output/evals/scenarios",
  `${scenario.id}-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
fs.mkdirSync(folder, { recursive: true });

let store: Store | undefined;
let answers: AnswersProvider | undefined;
let provider: Provider;
let cliVersion = "";
if (mode === "live") {
  // Claude Code's free checks first: found, recent enough and signed in (L-71). The cap is the
  // owner's approved one; the runner refuses one above the scenario file's budget.
  const found = await liveClaudeProvider();
  provider = found.provider;
  cliVersion = found.cliVersion;
  console.log(`LIVE: ${scenario.id}, hard cap ${cap}, Claude Code ${cliVersion}.`);
} else {
  const loaded = loadAnswers(file ?? path.join(scenarios, "rehearsals", `${id}.json`));
  if (loaded.scenario !== scenario.id) {
    throw new Error(`The answers are for ${loaded.scenario}, not ${scenario.id}.`);
  }
  // The saved tools a recorded answer names are looked up in the run's own Tessera.
  answers = answersProvider(
    loaded,
    (name) => store && listSavedTools(store).find((t) => t.name === name)?.id,
  );
  provider = answers;
}

let savedTools: { id: string; name: string }[] = [];
const report = await runScenario(scenario, {
  mode,
  provider,
  folder,
  ...(cap !== undefined ? { callCap: cap } : {}),
  onStarted: (started) => (store = started),
  onFinished: (finished) => {
    savedTools = listSavedTools(finished).map((t) => ({ id: t.id, name: t.name }));
  },
  ...(answers ? { misfits: () => answers.misfits(), stale: () => answers.stale() } : {}),
});
fs.writeFileSync(path.join(folder, "report.md"), reportMarkdown(report));
console.log(reportMarkdown(report));

if (mode === "live") {
  // The run becomes a replay (EVAL-07): reviewed, then copied to evals/scenarios/replays/.
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const { answers: recorded, skipped } = recordAnswers({
    harnessFolder: path.join(folder, "harness"),
    scenario: scenario.id,
    savedTools,
    recorded: { head, at: new Date().toISOString(), cliVersion },
  });
  fs.writeFileSync(path.join(folder, "answers.json"), `${JSON.stringify(recorded, null, 2)}\n`);
  for (const note of skipped) console.log(`Not recorded: ${note}`);
  console.log(`Replay answers: ${path.join(folder, "answers.json")}`);
}
console.log(`Evidence: ${folder}`);
process.exitCode = report.steps.every((s) => s.outcome === "passed") && !report.stopped ? 0 : 1;
