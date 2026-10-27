import { z } from "zod";
import { UI_MODES } from "./artifact.ts";
import { BRIDGE_CAPABILITIES } from "./bridge.ts";
import { jsonObjectSchema } from "./json.ts";

// What the generation stages answer, and how their failures are classed (CON-02, GEN-05, GEN-09).
// Each answer is a discriminated union, so a field exists only where it means something, and no
// null stands for two things.

/** Why a candidate failed; each class has its own repair (GEN-09). A provider failure is never repaired. */
export const FAILURE_CLASSES = ["schema-shape", "static", "smoke", "behavior", "provider"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

const capabilities = Object.keys(BRIDGE_CAPABILITIES) as [
  keyof typeof BRIDGE_CAPABILITIES,
  ...(keyof typeof BRIDGE_CAPABILITIES)[],
];

const code = z
  .strictObject({ html: z.string(), css: z.string(), js: z.string() })
  .describe("The tool: the HTML inside its page's body, its CSS and its JavaScript.");

export const creationSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("tool"),
      name: z
        .string()
        .min(1)
        .max(80)
        .describe("The tool's name, short, in the person's language and plain words."),
      summary: z
        .string()
        .min(1)
        .max(400)
        .describe("What the tool does, in one or two plain sentences for the person."),
      code,
      data: z.strictObject({
        schema: jsonObjectSchema.describe(
          "The JSON Schema of the tool's data: an object of lists of records, each with a string id.",
        ),
        reusableDefaults: jsonObjectSchema.describe(
          "Data worth keeping when the tool is used again, such as settings or categories; never the person's own entries.",
        ),
        initialState: jsonObjectSchema.describe(
          "The entries this request itself gives, such as the items it lists; {} when it gives none.",
        ),
      }),
      capabilities: z
        .array(z.enum(capabilities))
        .describe("The host capabilities the tool needs, only those it uses (CAP-01)."),
      uiMode: z
        .enum(UI_MODES)
        .describe(
          "custom only when the person asked for their own design or to drop the standard.",
        ),
    }),
    z.strictObject({
      outcome: z.literal("cannot"),
      reason: z
        .string()
        .min(1)
        .max(400)
        .describe("Why no tool here can do this, in plain words for the person."),
    }),
  ])
  .describe("The create stage's answer: a new tool, or why none can be made (CON-02, GEN-05).");
export type Creation = z.infer<typeof creationSchema>;
