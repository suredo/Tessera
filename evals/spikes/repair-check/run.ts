// Docs: docs/code/evals/repair-check.md
// LIVE with --live: makes real model calls, only with the owner's approval of the budget (ENG-07).
// The repair check (#146, GEN-09, ENG-16): do the repair stage's prompt parts get a real model to
// fix a creation that failed the host's checks? Creation's answers are replayed from the slice
// pilot's live run; only the repairs reach the model, through the harness's cap and ledger.
//   node evals/spikes/repair-check/run.ts --dry-run                (a fake claude, no cost)
//   node evals/spikes/repair-check/run.ts --live --approved-cap 3  (the real CLI)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_ROUTES, type Creation, type Intent } from "@tessera/contracts";
import { candidateFrom, createTool, type Provider } from "@tessera/server";
import { readLedger, startHarness, summarizeLedger, type RunMode } from "../../src/index.ts";
import {
  fakeClaudeProvider,
  liveClaudeProvider,
  runFolder,
  runModeFrom,
} from "../cli-contract/claude-cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

type Tool = Extract<Creation, { outcome: "tool" }>;
type Replay = { stage: string; answer: unknown };

const pilot = (
  JSON.parse(
    fs.readFileSync(
      path.join(here, "..", "slice-pilot", "replays", "pilot-2026-10-27.json"),
      "utf8",
    ),
  ) as { replays: Replay[] }
).replays;
const intent = pilot[0]!.answer as Intent;
/** The pilot's first live shopping list: its reusable defaults lacked the list its schema requires. */
const shoppingList = pilot[1]!.answer as Tool;
/** The same tool with its defaults right, and one line that builds HTML at run time. */
const runtimeHtml =
  'const count = document.querySelectorAll("li").length;\n' +
  'document.querySelector("h1").insertAdjacentHTML("afterend", "<p>" + count + " items</p>");\n';
const withRuntimeHtml: Tool = {
  ...shoppingList,
  data: { ...shoppingList.data, reusableDefaults: { items: [] } },
  code: { ...shoppingList.code, js: `${shoppingList.code.js}\n${runtimeHtml}` },
};

/** The run the owner approved on 2026-10-27: one repair per case, a hard cap of 3 calls. */
export const PLAN = {
  callCap: 3,
  request: "I need a shopping list I can tick off at the store, with milk, eggs and bread on it.",
  cases: [
    { name: "schema-shape", created: shoppingList },
    { name: "static", created: withRuntimeHtml },
  ],
} as const;

export type CaseReport = {
  case: string;
  /** The class the replayed creation failed with, before the repair. */
  failedWith: string;
  /** What came of the request: a candidate, or the class it still failed with. */
  outcome: string;
  repairs: number;
  findings: string[];
};

// The dry run's repairs: each case's answer, fixed as a model should fix it.
const envelope = (answer: unknown) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1000,
  structured_output: { answer },
  usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 1,
  },
});
const dryRunReplies = [
  envelope({ ...shoppingList, data: { ...shoppingList.data, reusableDefaults: { items: [] } } }),
  envelope({ ...withRuntimeHtml, code: shoppingList.code }),
];

async function providerFor(mode: RunMode, folder: string): Promise<Provider> {
  if (mode === "live") return (await liveClaudeProvider()).provider;
  const replies = path.join(folder, "replies.json");
  fs.writeFileSync(replies, JSON.stringify(dryRunReplies));
  return fakeClaudeProvider(replies, path.join(folder, "calls"));
}

/** Creation answers from the replay, at no cost; every other stage goes to the capped harness. */
function replayingCreation(created: Tool, harnessed: Provider): Provider {
  return {
    name: `replay+${harnessed.name}`,
    live: harnessed.live,
    run: async (spec) => {
      if (spec.stage !== "create") return harnessed.run(spec);
      const value = spec.schema.parse(created);
      return {
        value,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, durationMs: 0 },
        raw: JSON.stringify(created),
      };
    },
  };
}

export async function runCheck(mode: RunMode): Promise<string> {
  const folder = runFolder("repair-check", mode);
  fs.mkdirSync(folder, { recursive: true });
  const harness = startHarness({
    provider: await providerFor(mode, folder),
    mode,
    callCap: PLAN.callCap,
    dataFolder: path.join(folder, "harness"),
  });
  const reports: CaseReport[] = [];
  for (const { name, created } of PLAN.cases) {
    const before = candidateFrom(created);
    if (before.kind !== "failed" || before.failure !== name) {
      throw new Error(`The ${name} case doesn't fail with ${name} before its repair.`);
    }
    const result = await createTool(replayingCreation(created, harness.provider), DEFAULT_ROUTES, {
      request: PLAN.request,
      intent,
    });
    reports.push({
      case: name,
      failedWith: before.failure,
      outcome: result.kind === "failed" ? `failed: ${result.failure}` : result.kind,
      repairs: result.repairs ?? 0,
      findings: result.kind === "failed" ? result.findings : [],
    });
  }
  fs.writeFileSync(
    path.join(folder, "report.json"),
    `${JSON.stringify({ mode, plan: { callCap: PLAN.callCap, request: PLAN.request }, cases: reports, ledger: summarizeLedger(readLedger(harness.dataFolder)) }, null, 2)}\n`,
  );
  return folder;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const mode = runModeFrom(process.argv.slice(2), PLAN.callCap);
  const folder = await runCheck(mode);
  console.log(`The repair check's ${mode} is in ${folder}`);
  console.log(fs.readFileSync(path.join(folder, "report.json"), "utf8"));
}
