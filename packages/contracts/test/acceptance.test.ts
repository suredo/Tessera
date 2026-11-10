import { describe, expect, it } from "vitest";
import { ACCEPTANCE_LIMITS, acceptanceSchema, type Acceptance } from "../src/index.ts";

// The acceptance stage's answer (VER-09): hooks the tool must expose, and checks that use only
// those hooks; or none, with a reason.

const answer = (overrides: Partial<Extract<Acceptance, { outcome: "checks" }>> = {}) => ({
  outcome: "checks" as const,
  hooks: [
    { name: "thing-name", says: "the field for a new thing's name" },
    { name: "thing-add", says: "the button that adds it" },
    { name: "thing", says: "each thing in the list" },
  ],
  checks: [
    {
      says: "Adding sunscreen shows it in the list",
      steps: [
        { do: "fill" as const, hook: "thing-name", value: "Sunscreen" },
        { do: "click" as const, hook: "thing-add" },
      ],
      expect: { see: "shows" as const, hook: "thing", text: "Sunscreen" },
    },
  ],
  ...overrides,
});

describe("the acceptance stage's answer (VER-09)", () => {
  it("VER-09: takes hooks and checks that use only them, or none with a reason", () => {
    expect(acceptanceSchema.safeParse(answer()).success).toBe(true);
    expect(
      acceptanceSchema.safeParse({ outcome: "none", reason: "It asks only for a darker look." })
        .success,
    ).toBe(true);
  });

  it("VER-09: refuses a check that uses a hook the answer doesn't declare, in a step or what it expects", () => {
    const [check] = answer().checks;
    const inStep = {
      ...check!,
      steps: [{ do: "click" as const, hook: "thing-save" }],
    };
    const inExpect = { ...check!, expect: { see: "shows" as const, hook: "things", text: "x" } };
    expect(acceptanceSchema.safeParse(answer({ checks: [inStep] })).success).toBe(false);
    expect(acceptanceSchema.safeParse(answer({ checks: [inExpect] })).success).toBe(false);
  });

  it("VER-09: refuses a hook declared twice, or one that isn't lowercase words and dashes", () => {
    const hooks = answer().hooks;
    expect(acceptanceSchema.safeParse(answer({ hooks: [...hooks, hooks[0]!] })).success).toBe(
      false,
    );
    for (const name of ["Thing", "thing name", "thing_add", "-thing", "thing-"]) {
      expect(
        acceptanceSchema.safeParse(answer({ hooks: [...hooks, { name, says: "x" }] })).success,
        name,
      ).toBe(false);
    }
  });

  it("VER-09: keeps to a few checks and steps", () => {
    const [check] = answer().checks;
    const many = Array.from({ length: ACCEPTANCE_LIMITS.checks + 1 }, () => check!);
    expect(acceptanceSchema.safeParse(answer({ checks: many })).success).toBe(false);
    const steps = Array.from({ length: ACCEPTANCE_LIMITS.steps + 1 }, () => check!.steps[1]!);
    expect(acceptanceSchema.safeParse(answer({ checks: [{ ...check!, steps }] })).success).toBe(
      false,
    );
  });
});
