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

  it("finds numbers in intersections and shared definitions, under the field's name (CON-05)", () => {
    const positive = () => z.intersection(z.number(), z.number().min(0));
    const intersections = z.object({ wait: positive(), waitSeconds: positive() });
    expect(numericFieldsWithoutUnit(z.toJSONSchema(intersections))).toEqual(["wait"]);

    const withReferences = {
      $defs: { Delay: { type: "number" }, Step: { properties: { pause: { type: "integer" } } } },
      properties: {
        delay: { $ref: "#/$defs/Delay" },
        delayMs: { $ref: "#/$defs/Delay" },
        step: { $ref: "#/$defs/Step" },
      },
    };
    expect(numericFieldsWithoutUnit(withReferences).sort()).toEqual(["$defs.Step.pause", "delay"]);
  });
});
