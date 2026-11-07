// Docs: docs/code/evals/runner.md
// Plays a scenario: node evals/src/runner/cli.ts <scenario-id> [--replay <file> | --live --cap <n>]
// [--two-pass]. The default is its rehearsal, evals/scenarios/rehearsals/<id>.json, or
// <id>.two-pass.json with --two-pass, which makes big tools in two passes (GEN-17) at their
// starting point. Build first: pnpm build.
// --live is LIVE: it calls Claude Code, so it needs the owner's approved cap first (ENG-07,
// docs/practices/live-evaluation.md, evals/reports/2026-11-05-m2-live-run.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSavedTools, TWO_PASS_STARTING_POINT } from "@tessera/server";
import { liveClaudeProvider } from "../../spikes/cli-contract/claude-cli.ts";
import { loadScenario } from "../scenarios/index.ts";
import { recordAnswers } from "./record.ts";
import { reportMarkdown } from "./report.ts";
import { replayScenario } from "./replay.ts";
import { runScenario, type RunMode, type RunReport } from "./run.ts";

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

// Two passes for big tools, to compare them with one (GEN-17): a flag anywhere in the command.
const words = process.argv.slice(2);
const twoPass = words.includes("--two-pass");
const { id, mode, file, cap } = parse(words.filter((word) => word !== "--two-pass"));
const scenario = loadScenario(path.join(scenarios, `${id}.yaml`));
const folder = path.resolve(
  here,
  "../../../test-output/evals/scenarios",
  `${scenario.id}-${mode}${twoPass ? "-two-pass" : ""}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
fs.mkdirSync(folder, { recursive: true });

let cliVersion = "";
let savedTools: { id: string; name: string }[] = [];
let report: RunReport;
if (mode === "live") {
  // Claude Code's free checks first: found, recent enough and signed in (L-71). The cap is the
  // owner's approved one; the runner refuses one above the scenario file's budget.
  const found = await liveClaudeProvider();
  cliVersion = found.cliVersion;
  console.log(`LIVE: ${scenario.id}, hard cap ${cap}, Claude Code ${cliVersion}.`);
  report = await runScenario(scenario, {
    mode,
    provider: found.provider,
    folder,
    ...(cap !== undefined ? { callCap: cap } : {}),
    ...(twoPass ? { twoPass: TWO_PASS_STARTING_POINT } : {}),
    onFinished: (finished) => {
      savedTools = listSavedTools(finished).map((t) => ({ id: t.id, name: t.name }));
    },
  });
} else {
  report = await replayScenario(scenario, {
    mode,
    file: file ?? path.join(scenarios, "rehearsals", `${id}${twoPass ? ".two-pass" : ""}.json`),
    folder,
    ...(twoPass ? { twoPass: TWO_PASS_STARTING_POINT } : {}),
  });
}
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
