// Docs: docs/code/evals/scenarios.md
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  connectionInputSchema,
  connectionNameSchema,
  FILE_SAVE_HOOK,
  PROFILES,
  profileIdSchema,
  reviewItemSchema,
} from "@tessera/contracts";

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
      .enum(["changed", "unchanged", "kept"])
      .optional()
      .describe(
        "The open workspace's data changed, stayed exactly as it was, or kept every earlier value while it may have gained some.",
      ),
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
    downloaded: z
      .union([z.boolean(), z.string().min(1).max(255)])
      .optional()
      .describe(
        "The browser saved a file during the step (true), none (false), or one with this name (CAP-03).",
      ),
  })
  .describe("Host facts a step expects; each one left out isn't checked.");
export type Expectation = z.infer<typeof expectationSchema>;

const expect = expectationSchema.optional();
const name = z.string().min(1).max(200);

/** A verification profile's hook name, as a tool marks it in `data-hook` (VER-03). */
const hookName = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "a hook name such as item-add");

/** Where a `do` step acts: inside the one shown element marked `hook` whose text shows `text`. */
const within = z
  .strictObject({ hook: hookName, text: z.string().min(1).max(200) })
  .describe("Inside the one shown element marked hook whose text shows text, such as one item.");

/** Of several elements marked with the hook, the one whose label shows this text, as a field. */
const label = z
  .string()
  .min(1)
  .max(200)
  .describe("Of the elements marked with the hook, the one whose label shows this text.");

/** A file the scenario keeps in evals/scenarios/files, by its name, for the person to pick. */
export const scenarioFileSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/,
    "a file name in evals/scenarios/files, such as beach.png",
  )
  .describe("A file in evals/scenarios/files the person picks, by its name.");

/**
 * Using one of the tool's own controls, as the person would (EVAL-01, from M3): clicking the
 * element marked with a hook, or typing a value into it (a select takes the choice it names), the
 * one shown, or the one inside an element `in` names, or of several, the one whose label shows
 * `label`, as a person finds one field of a form.
 */
const doSchema = z.union([
  z.strictObject({
    click: hookName,
    in: within.optional(),
    label: label.optional(),
    pick: scenarioFileSchema
      .optional()
      .describe(
        "The click opens the browser's file picker, where the person picks this file (A80).",
      ),
    answer: z
      .enum(["save", "dont-save"])
      .optional()
      .describe("The click makes Tessera ask about saving a file, which the person answers (A81)."),
  }),
  z.strictObject({
    fill: hookName,
    value: z.string().max(2000),
    in: within.optional(),
    label: label.optional(),
  }),
]);
export type DoAction = z.infer<typeof doSchema>;

/** One step of a scenario: what the person does, and what the host should show after it. */
export const stepSchema = z.union([
  z.strictObject({
    say: z.string().min(1).describe("A chat request, in the scenario's language."),
    expect,
  }),
  z.strictObject({
    do: doSchema.describe(
      "The tool's own control, through a hook of one of the scenario's verification profiles.",
    ),
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
  z.strictObject({
    move: z
      .literal(true)
      .describe(
        "The person moves to another computer (DATA-05, P2): the open workspace is exported to a file, with the tools saved from it, and imported into Tessera started again on a new, empty data folder.",
      ),
    expect,
  }),
]);
export type Step = z.infer<typeof stepSchema>;

/** The steps the runner plays. */
export const STEPS = [
  "say",
  "do",
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
  "move",
] as const;

/**
 * What a fake service answers a path with (CAP-02, #349 step 5): text, or an image, which is a
 * real 1-pixel PNG. A request gets the answer whose path is the longest its own starts with.
 */
const serviceAnswerSchema = z
  .strictObject({
    path: z
      .string()
      .regex(/^\/[^\s?#]*$/, "a path such as /search, without a query")
      .describe("The path this answer is for; its query is ignored."),
    status: z.int().min(100).max(599).default(200),
    type: z.string().min(1).max(200).default("application/json"),
    body: z
      .string()
      .max(64 * 1024)
      .optional(),
    image: z.literal(true).optional().describe("Answers with a real PNG image."),
  })
  .refine((answer) => (answer.body === undefined) !== (answer.image === undefined), {
    message: "an answer has a body or is an image, not both",
  });

/**
 * A fake outside service the runner serves on loopback and adds to the run's Tessera as a
 * connection the person added, so no run reaches a real service (ADR 0015).
 */
const serviceSchema = z.strictObject({
  connection: connectionNameSchema.describe("The connection's name, as the person added it."),
  key: connectionInputSchema.shape.key
    .unwrap()
    .optional()
    .describe("A made-up key, sent as Authorization: Bearer; none when left out."),
  answers: z.array(serviceAnswerSchema).min(1).max(20),
});

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
    profiles: z
      .array(profileIdSchema)
      .default([])
      .describe(
        "The verification profiles the person's tools should match; a do step uses their hooks.",
      ),
    acceptanceChecks: z
      .boolean()
      .default(false)
      .describe(
        "Runs Tessera with checks from the request on (VER-09): a new tool that fits no profile gets checks written from the request. Off unless set, so a recording made without them still replays; Tessera itself has them on (A57).",
      ),
    services: z
      .array(serviceSchema)
      .max(3)
      .default([])
      .refine(
        (services) => new Set(services.map((s) => s.connection)).size === services.length,
        "each service's connection once",
      )
      .describe("The outside services its tools reach through connections the person added."),
    steps: z.array(stepSchema).min(1),
    review: z
      .array(reviewItemSchema)
      .default([])
      .describe("The AI review's items for this scenario (EVAL-03), from the one rubric."),
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
    // A do step drives the tool through hooks its profiles name, which the prompt asked it to
    // mark (VER-04); any other name would be guessing at the tool's markup. A click answered as
    // a save may also press the save button, which the files part asks a saving tool to mark (A86).
    const hooks = new Set<string>(
      scenario.profiles.flatMap((id) => PROFILES[id].hooks.map((h) => h.name)),
    );
    scenario.steps.forEach((s, index) => {
      if (!("do" in s)) return;
      const allowed = (hook: string) =>
        hooks.has(hook) ||
        ("click" in s.do && s.do.answer !== undefined && hook === FILE_SAVE_HOOK);
      const used = ["click" in s.do ? s.do.click : s.do.fill, ...(s.do.in ? [s.do.in.hook] : [])];
      for (const hook of used.filter((each) => !allowed(each))) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "do"],
          message: `the hook ${hook} isn't one of the scenario's profiles' hooks`,
        });
      }
    });
  })
  .describe("A scenario file (EVAL-01).");
export type Scenario = z.infer<typeof scenarioSchema>;

/** A step's kind: the one key it has besides `expect`. */
export const stepKind = (s: Step): (typeof STEPS)[number] =>
  Object.keys(s).find((key) => key !== "expect") as (typeof STEPS)[number];

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
