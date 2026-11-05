// Docs: docs/code/evals/scenarios.md
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// Scenario files (EVAL-01): one person, one goal, a language, a budget and steps, each with the
// host facts it expects (EVAL-02). Every scenario starts from an empty Tessera. The format is in
// docs/testing/scenario-format.md; this is its one definition.

/** What a step expects the host to show, checked without a model (EVAL-02). */
export const expectationSchema = z
  .strictObject({
    created: z.boolean().optional().describe("A new workspace with a tool appeared, or none did."),
    version: z
      .enum(["new", "unchanged"])
      .optional()
      .describe("The open workspace's tool version changed, or stayed as it was."),
    data: z
      .enum(["changed", "unchanged"])
      .optional()
      .describe("The open workspace's data changed, or stayed exactly as it was."),
    workspace: z
      .enum(["new", "same", "original"])
      .optional()
      .describe(
        "The workspace open after the step: a new one, the one open before, or the one the saved tool's Continue opens.",
      ),
    offered: z
      .enum(["saved"])
      .optional()
      .describe("A saved tool was offered to open, with Continue or Use again (GEN-18)."),
    savedTool: z.string().min(1).optional().describe("The saved tool offered, by its name."),
    answer: z
      .enum(["clarify", "unsupported", "stopped"])
      .optional()
      .describe("The host answered instead of making or changing a tool."),
  })
  .describe("Host facts a step expects; each one left out isn't checked.");
export type Expectation = z.infer<typeof expectationSchema>;

const expect = expectationSchema.optional();
const name = z.string().min(1).max(200);

/** One step of a scenario: what the person does, and what the host should show after it. */
export const stepSchema = z.union([
  z.strictObject({
    say: z.string().min(1).describe("A chat request, in the scenario's language."),
    expect,
  }),
  z.strictObject({
    do: z
      .looseObject({ hook: z.string().min(1) })
      .describe("The tool's own control, through a verification profile's hook (from M3)."),
    expect,
  }),
  z.strictObject({
    "next-day": z.literal(true).describe("The host clock moves a day, and the page reloads."),
    expect,
  }),
  z.strictObject({ reload: z.literal(true), expect }),
  z.strictObject({
    save: name.describe("Save the open workspace to my tools under this name."),
    expect,
  }),
  z.strictObject({ continue: name.describe("Continue the saved tool with this name."), expect }),
  z.strictObject({
    "use-again": name.describe("Use the saved tool with this name again, with fresh data."),
    expect,
  }),
  z.strictObject({ undo: z.enum(["data", "interface"]), expect }),
  z.strictObject({
    cancel: z.literal(true).describe("Cancel the request that is running."),
    expect,
  }),
  z.strictObject({
    switch: z.union([z.literal("new"), name]).describe("A new empty workspace, or one by name."),
    expect,
  }),
  z.strictObject({
    delete: name.describe("Move the workspace with this name to the trash."),
    expect,
  }),
  z.strictObject({
    restore: name.describe("Restore the workspace with this name from the trash."),
    expect,
  }),
]);
export type Step = z.infer<typeof stepSchema>;

/** The steps the M2 runner can drive: no `do`, which needs verification profiles (M3). */
export const M2_STEPS = [
  "say",
  "next-day",
  "reload",
  "save",
  "continue",
  "use-again",
  "undo",
  "cancel",
  "switch",
  "delete",
  "restore",
] as const;

export const scenarioSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Z]\d+(-[a-z0-9]+)+$/, "an ID such as T1-shopping-list"),
    tier: z.enum(["simple", "intermediate", "advanced", "limits"]),
    language: z.string().min(2).describe("A BCP 47 tag, such as en or pt-BR."),
    person: z.string().min(1),
    goal: z.string().min(1).optional(),
    clock: z.strictObject({
      start: z.iso.datetime({ local: true }),
      zone: z.string().min(1),
    }),
    budget: z.strictObject({
      calls: z.int().min(1).describe("The most model calls its live run may make (ENG-07)."),
    }),
    profiles: z.array(z.string().min(1)).default([]),
    steps: z.array(stepSchema).min(1),
    review: z.array(z.string().min(1)).default([]),
  })
  .superRefine((scenario, context) => {
    // A cancel stops the request the step before started, so that step is a request whose own
    // outcome isn't waited for or checked.
    scenario.steps.forEach((s, index) => {
      if (!("cancel" in s)) return;
      const before = scenario.steps[index - 1];
      if (!before || !("say" in before) || before.expect) {
        context.addIssue({
          code: "custom",
          path: ["steps", index],
          message: "a cancel step follows a say step that expects nothing of its own",
        });
      }
    });
  })
  .describe("A scenario file (EVAL-01).");
export type Scenario = z.infer<typeof scenarioSchema>;

/** A step's kind: the one key it has besides `expect`. */
export const stepKind = (s: Step): (typeof M2_STEPS)[number] | "do" =>
  Object.keys(s).find((key) => key !== "expect") as (typeof M2_STEPS)[number] | "do";

/** A scenario file that isn't one, with every problem in plain words. */
export class ScenarioError extends Error {
  constructor(file: string, problems: string[]) {
    super(`${file} isn't a scenario: ${problems.join("; ")}`);
    this.name = "ScenarioError";
  }
}

/** Reads and checks one scenario file. Its file name must be its ID. */
export function loadScenario(file: string): Scenario {
  let raw: unknown;
  try {
    raw = parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ScenarioError(file, [error instanceof Error ? error.message : String(error)]);
  }
  const checked = scenarioSchema.safeParse(raw);
  if (!checked.success) {
    throw new ScenarioError(
      file,
      checked.error.issues.map(
        (issue) => `${issue.path.join(".") || "the file"}: ${issue.message}`,
      ),
    );
  }
  const expected = path.basename(file, path.extname(file));
  if (checked.data.id !== expected) {
    throw new ScenarioError(file, [`its id is ${checked.data.id}, but the file is ${expected}`]);
  }
  return checked.data;
}

/** Every scenario in a folder, by ID. */
export function loadScenarios(folder: string): Scenario[] {
  return fs
    .readdirSync(folder)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => loadScenario(path.join(folder, file)));
}

/**
 * Why the M2 runner can't play a scenario, or nothing: a `do` step needs verification profiles,
 * which arrive in M3.
 */
export function m2Problems(scenario: Scenario): string[] {
  return scenario.steps.flatMap((s, index) =>
    stepKind(s) === "do"
      ? [`Step ${index + 1} uses the tool's own controls, which need verification profiles (M3).`]
      : [],
  );
}
