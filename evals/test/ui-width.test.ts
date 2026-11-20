import { expect, it } from "vitest";
import fs from "node:fs";
import { z } from "zod";
import { candidateFrom, UNKNOWN_USAGE, type Provider } from "@tessera/server";
import { creationSchema } from "@tessera/contracts";
import { caseProvider, PLAN } from "../spikes/ui-width/run.ts";

it("ENG-07, OBS-02: a width case permits only creation and one repair within the four-call plan", async () => {
  let reached = 0;
  const canned: Provider = {
    name: "width-guard",
    live: false,
    run: (spec) => {
      reached++;
      return Promise.resolve({
        value: spec.schema.parse(spec.stage),
        usage: UNKNOWN_USAGE,
        raw: spec.stage,
      });
    },
  };
  const provider = caseProvider(canned);
  const spec = {
    stage: "create",
    system: "",
    prompt: "",
    schema: z.string(),
    model: "test",
    effort: "low",
    tools: "none",
    timeLimitMs: 1000,
  } as const;
  expect(PLAN.callCap).toBe(4);
  expect(() => provider.run({ ...spec, stage: "intent" })).toThrow("Only creation");
  await expect(provider.run(spec)).resolves.toMatchObject({ value: "create" });
  await expect(provider.run({ ...spec, stage: "repair" })).resolves.toMatchObject({
    value: "repair",
  });
  expect(() => provider.run({ ...spec, stage: "repair" })).toThrow("repair reserve");
  expect(reached).toBe(2);
});

it("APP-01, TEST-04: recorded live creations produce the expected default or explicit widths and pass the host checks", () => {
  const answers = z
    .array(z.object({ stage: z.literal("create"), answer: creationSchema }))
    .parse(
      JSON.parse(
        fs.readFileSync(
          new URL("../spikes/ui-width/replays/2026-11-20.json", import.meta.url),
          "utf8",
        ),
      ),
    );
  expect(answers).toHaveLength(PLAN.cases.length);
  for (const [index, reply] of answers.entries()) {
    const expected = PLAN.cases[index]!.expected;
    expect(reply.answer).toMatchObject({ outcome: "tool" });
    if (expected === "wide") expect(reply.answer).toMatchObject({ uiWidth: "wide" });
    else expect(reply.answer).not.toHaveProperty("uiWidth");
    expect(candidateFrom(reply.answer)).toMatchObject({
      kind: "candidate",
      artifact: { ui: { width: expected } },
    });
  }
});
