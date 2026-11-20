import { expect, it } from "vitest";
import { z } from "zod";
import { UNKNOWN_USAGE, type Provider } from "@tessera/server";
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
