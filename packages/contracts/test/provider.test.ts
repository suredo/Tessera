import { describe, expect, it } from "vitest";
import { z } from "zod";
import { numericFieldsWithoutUnit, providerScriptSchema, usageSchema } from "../src/index.ts";

describe("provider contracts (CLI-01, CLI-04, ENG-11)", () => {
  // A canned reply's value is any JSON: its shape, numbers included, is the stage's own contract.
  it("names the unit of every usage number (CON-05)", () => {
    expect(numericFieldsWithoutUnit(z.toJSONSchema(usageSchema))).toEqual([]);
  });

  it("keeps unknown usage as null, never as a number", () => {
    const unknown = { inputTokens: null, cachedInputTokens: null, outputTokens: null };
    expect(usageSchema.safeParse({ ...unknown, durationMs: null }).success).toBe(true);
    expect(usageSchema.safeParse({ ...unknown }).success).toBe(false);
    expect(usageSchema.safeParse({ ...unknown, durationMs: -1 }).success).toBe(false);
  });

  it("needs each canned reply to have a value or an error, for a known stage", () => {
    const parse = (reply: unknown) =>
      providerScriptSchema.safeParse({ name: "t", replies: [reply] });
    expect(parse({ kind: "value", stage: "intent", value: null }).success).toBe(true);
    expect(parse({ kind: "value", stage: "intent" }).success).toBe(false);
    expect(parse({ kind: "error", stage: "edit", error: "sign_in" }).success).toBe(true);
    expect(parse({ kind: "error", stage: "edit", error: "boom" }).success).toBe(false);
    expect(parse({ kind: "value", stage: "chat", value: 1 }).success).toBe(false);
  });
});
