import { z } from "zod";

// Acceptance checks from the request (VER-09, A49, an M3 experiment): for a tool that fits no
// verification profile, a separate stage, never the generator, turns the person's request into a
// few checks the host runs before the tool opens. Each check names the hooks the tool must expose,
// what to do with them and what should then be seen; the generation prompt states them as
// requirements (VER-04), and the check enforces only what they state. The checks build on the
// driver's steps, so the host runs them as it runs a profile's (VER-03).

/** How many checks a request gets, and how many hooks and steps they may name. */
export const ACCEPTANCE_LIMITS = { checks: 3, hooks: 8, steps: 6 } as const;

/** A hook's name: what the tool marks with `data-hook="<name>"`, in lowercase words and dashes. */
export const hookNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "lowercase words joined by dashes")
  .max(40);

const plain = (max: number) => z.string().trim().min(1).max(max);

/** What the person does in a check: types a value into a hooked field, or presses a hooked control. */
export const acceptanceStepSchema = z.discriminatedUnion("do", [
  z.strictObject({ do: z.literal("fill"), hook: hookNameSchema, value: plain(100) }),
  z.strictObject({ do: z.literal("click"), hook: hookNameSchema }),
]);
export type AcceptanceStep = z.infer<typeof acceptanceStepSchema>;

/**
 * What should then be seen, through one hook: an element it marks shows `text`; none shows it; or
 * the number of elements it marks changes by `changeCount` from before the steps. A change is relative,
 * so a check never depends on entries the stage can't know.
 */
export const acceptanceExpectSchema = z.discriminatedUnion("see", [
  z.strictObject({ see: z.literal("shows"), hook: hookNameSchema, text: plain(100) }),
  z.strictObject({ see: z.literal("hides"), hook: hookNameSchema, text: plain(100) }),
  z.strictObject({
    see: z.literal("count-change"),
    hook: hookNameSchema,
    changeCount: z.int().min(-20).max(20),
  }),
]);
export type AcceptanceExpect = z.infer<typeof acceptanceExpectSchema>;

/** One check: what it checks in the person's words, the steps, and what should then be seen. */
export const acceptanceCheckSchema = z.strictObject({
  says: plain(200).describe("What the check shows, in plain words, as the person would say it."),
  steps: z.array(acceptanceStepSchema).min(1).max(ACCEPTANCE_LIMITS.steps),
  expect: acceptanceExpectSchema,
});
export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>;

const checksObject = z.strictObject({
  outcome: z.literal("checks"),
  hooks: z
    .array(z.strictObject({ name: hookNameSchema, says: plain(160) }))
    .min(1)
    .max(ACCEPTANCE_LIMITS.hooks),
  checks: z.array(acceptanceCheckSchema).min(1).max(ACCEPTANCE_LIMITS.checks),
});

/** No hook twice, and every hook a check uses declared, so the prompt asks for every one. */
function declaredHooks(answer: z.infer<typeof checksObject>, context: z.RefinementCtx): void {
  const named = new Set<string>();
  answer.hooks.forEach(({ name }, index) => {
    if (named.has(name)) {
      context.addIssue({
        code: "custom",
        path: ["hooks", index, "name"],
        message: `${name} twice`,
      });
    }
    named.add(name);
  });
  answer.checks.forEach((check, index) => {
    for (const hook of [...check.steps.map((s) => s.hook), check.expect.hook]) {
      if (!named.has(hook)) {
        context.addIssue({
          code: "custom",
          path: ["checks", index],
          message: `uses the hook ${hook}, which isn't declared`,
        });
      }
    }
  });
}

/**
 * The acceptance stage's answer (VER-09): the hooks the tool must expose, each with what it marks,
 * and up to three checks that use only those hooks. Or none, when the request asks for nothing a
 * check could show through a tool's own controls, such as only a look.
 */
export const acceptanceSchema = z
  .discriminatedUnion("outcome", [
    checksObject,
    z.strictObject({
      outcome: z.literal("none"),
      reason: plain(200).describe("Why no check fits the request, in plain words."),
    }),
  ])
  .superRefine((answer, context) => {
    if (answer.outcome === "checks") declaredHooks(answer, context);
  })
  .describe("Acceptance checks for a tool that fits no profile (VER-09).");
export type Acceptance = z.infer<typeof acceptanceSchema>;

/** A request's checks, as a candidate carries them to staging and its repairs keep them. */
export const acceptanceChecksSchema = checksObject.superRefine(declaredHooks);
export type AcceptanceChecks = z.infer<typeof acceptanceChecksSchema>;
