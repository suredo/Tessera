// Docs: docs/code/evals/runner.md
import type { ScriptedReply } from "@tessera/contracts";
import { ANSWER_KEY } from "@tessera/server";
import { readLedger, readRequestLog } from "../harness/index.ts";
import type { Answers } from "./script.ts";

// A live run becomes a replay (EVAL-07, TEST-04): each call it made, in order, as the answer the
// stage got, from the harness's ledger and request log. A replay then runs offline, through the
// same pipeline and checks, and fails with "needs a new live run" if the pipeline asks for
// something else (docs/testing/scenarios.md).

/** How long a cancelled call's answer waits in the replay: long enough for the cancel to stop it. */
export const CANCELLED_WAIT_MS = 120_000;

/** The answer a call got, from its raw text: the CLI's envelope, or the answer itself. */
function answerOf(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed !== null && typeof parsed === "object" && "structured_output" in parsed) {
    const wrapped = (parsed as { structured_output?: Record<string, unknown> }).structured_output;
    return wrapped?.[ANSWER_KEY];
  }
  return parsed;
}

/**
 * The run's answers, from its harness folder. A saved tool's ID becomes `{{saved:<name>}}`, as
 * IDs are new on every run. A call the guard refused never started and isn't kept; a call that
 * broke (a bug, not a model's answer) can't be replayed and is listed in `skipped`.
 */
export function recordAnswers(input: {
  harnessFolder: string;
  scenario: string;
  savedTools: readonly { id: string; name: string }[];
  recorded: NonNullable<Answers["recorded"]>;
}): { answers: Answers; skipped: string[] } {
  const ledger = readLedger(input.harnessFolder);
  const requests = new Map(readRequestLog(input.harnessFolder).map((r) => [r.callIndex, r]));
  const named = (value: unknown): unknown => {
    let text = JSON.stringify(value);
    for (const tool of input.savedTools) text = text.split(tool.id).join(`{{saved:${tool.name}}}`);
    return JSON.parse(text) as unknown;
  };
  const skipped: string[] = [];
  const answers: Answers["answers"] = [];
  for (const entry of [...ledger].sort((a, b) => a.callIndex - b.callIndex)) {
    const { outcome, stage } = entry;
    const parts = entry.promptParts ? { parts: entry.promptParts } : {};
    if (outcome.kind === "refused") continue;
    if (outcome.kind === "crashed") {
      skipped.push(`Call ${entry.callIndex} (${stage}) broke: ${outcome.message}`);
      continue;
    }
    if (outcome.kind === "failed") {
      const reply: ScriptedReply = { kind: "error", stage, error: outcome.error };
      // A cancelled call is still running when the cancel comes, so its replay waits for it.
      answers.push({
        reply,
        ...(outcome.error === "cancelled" ? { delayMs: CANCELLED_WAIT_MS } : {}),
        ...parts,
      });
      continue;
    }
    const raw = requests.get(entry.callIndex)?.answer;
    if (raw === undefined || raw === null) {
      skipped.push(`Call ${entry.callIndex} (${stage}) has no answer in the request log.`);
      continue;
    }
    // Checked against the stage's own schema when the replay uses it, as a model's answer is.
    const reply = { kind: "value", stage, value: named(answerOf(raw)) } as ScriptedReply;
    answers.push({ reply, ...parts });
  }
  return {
    answers: {
      about: `A live run of ${input.scenario}, recorded for replay.`,
      scenario: input.scenario,
      recorded: input.recorded,
      answers,
    },
    skipped,
  };
}
