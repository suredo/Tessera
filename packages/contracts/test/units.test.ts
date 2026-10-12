import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  contracts,
  numericFieldsWithoutUnit,
  toJsonSchema,
  type ContractName,
} from "../src/index.ts";

describe("units in contracts", () => {
  it("every numeric field in every contract names its unit (CON-05)", () => {
    for (const name of Object.keys(contracts) as ContractName[]) {
      expect(numericFieldsWithoutUnit(toJsonSchema(name)), name).toEqual([]);
    }
  });

  it("finds numbers without a unit, nested or nullable, and allows counts and indexes (CON-05)", () => {
    const sample = z.object({
      wait: z.number(),
      waitSeconds: z.number(),
      retryCount: z.number().int(),
      index: z.number().int(),
      steps: z.array(z.object({ delay: z.number().nullable(), delayMs: z.number() })),
      size: z.union([z.number(), z.string()]),
    });
    expect(numericFieldsWithoutUnit(z.toJSONSchema(sample)).sort()).toEqual([
      "size",
      "steps.delay",
      "wait",
    ]);
  });
});
