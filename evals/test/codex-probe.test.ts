import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  restoreAnswer,
  wrapSchema,
  type Provider,
  type StageResult,
  type StageSpec,
} from "@tessera/server";
import { creationSchema, jsonSchemaOf } from "@tessera/contracts";
import { readLedger } from "../src/index.ts";
import { runModeFrom } from "../spikes/cli-contract/claude-cli.ts";
import {
  fakeProvider,
  inspectEvents,
  PLAN,
  plannedCalls,
  runProbe,
} from "../spikes/codex-probe/run.ts";

// The Codex probe's dry run (#266, ENG-07): the same calls through the product adapter, on the
// fake codex, in the system's temporary folder (ENG-19). It never reaches a model.
/** The dry run's create answer, turned back from how Codex writes it into the contract's shape. */
const creationAnswer = () => {
  const replies = JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "..", "spikes", "codex-probe", "dry-run-replies.json"),
      "utf8",
    ),
  ) as { answer: unknown }[];
  const wrapped = wrapSchema(jsonSchemaOf(creationSchema));
  return (restoreAnswer({ answer: replies[0]!.answer }, wrapped) as { answer: unknown }).answer;
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-codex-probe-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Codex probe (CLI-01, CLI-03, ENG-07, #266)", { timeout: 60_000 }, () => {
  it("ENG-07: a live run needs the approved cap, and the plan never asks for more calls than it", () => {
    expect(() => runModeFrom(["--live"], PLAN.callCap)).toThrow(/approved-cap/);
    expect(runModeFrom(["--live", "--approved-cap", String(PLAN.callCap)], PLAN.callCap)).toBe(
      "live",
    );
    expect(plannedCalls().length).toBeLessThanOrEqual(PLAN.callCap);
  });

  it("CLI-01: the dry run answers every planned call through the adapter and records it", async () => {
    const dataFolder = path.join(root, "run");
    const report = await runProbe({
      mode: "dry-run",
      provider: fakeProvider(dataFolder),
      dataFolder,
    });
    expect(report.calls.map((call) => [call.check, call.passed, call.notes])).toEqual(
      plannedCalls().map((call) => [call.check, true, []]),
    );
    expect(readLedger(dataFolder)).toHaveLength(plannedCalls().length);
    expect(fs.existsSync(path.join(dataFolder, "report.json"))).toBe(true);
  });

  it("CLI-03: an event that is a tool, a failure or missing usage is a problem", () => {
    const line = (event: object) => JSON.stringify(event);
    const done = line({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    expect(inspectEvents(done).problems).toEqual([]);
    expect(
      inspectEvents(
        [line({ type: "item.completed", item: { type: "command_execution" } }), done].join("\n"),
      ).problems,
    ).toEqual(["a tool item: command_execution"]);
    expect(inspectEvents(line({ type: "turn.completed" })).problems).toEqual([
      "usage is incomplete",
    ]);
  });

  it("CLI-03: a tool the model names fails the check, even when it isn't used", async () => {
    const dataFolder = path.join(root, "named");
    const done = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const answers = [
      creationAnswer(),
      { toolNames: ["shell"], note: "I can call shell but did not use it." },
    ];
    let call = 0;
    const provider: Provider = {
      name: "stub",
      live: false,
      run: <T>(spec: StageSpec<T>): Promise<StageResult<T>> =>
        Promise.resolve({
          value: spec.schema.parse(answers[call++]),
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, durationMs: 0 },
          raw: done,
        }),
    };
    const report = await runProbe({ mode: "dry-run", provider, dataFolder });
    expect(report.calls.at(-1)).toMatchObject({
      check: "no tools",
      passed: false,
      notes: ["a tool was offered: shell"],
    });
  });
});
