import { z } from "zod";
import { profileIdSchema } from "./profiles.ts";

// The intent stage's answer (GEN-01): what a request asks for, so the host can route it. Drafted
// for the intent spike (#20) and used by the intent stage (#144). Each kind is a branch of a
// discriminated union, so a field exists only where it means something (CON-02).

export const INTENT_KINDS = [
  "create",
  "edit",
  "data",
  "mixed",
  "new_tool",
  "open_saved",
  "clarify",
  "unsupported",
  // A question or an idea about a tool: answered in words, and nothing is built (GEN-19).
  "discuss",
  // Only while proposed entry changes wait for review: the request answers them in words.
  "approve_proposal",
  "decline_proposal",
] as const;

const feature = z.strictObject({
  name: z.string().min(1).describe("A short name for one separate thing the request asks for."),
  request: z.string().min(1).describe("The part of the request it comes from, as written."),
});

const common = {
  interfacePart: z
    .string()
    .min(1)
    .nullable()
    .describe("What the request asks of the interface, in its own words; null if nothing."),
  dataPart: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "What the request asks of the data (records to add, change or remove); null if nothing.",
    ),
  behaviorChange: z
    .boolean()
    .describe(
      "True when the request changes how the tool behaves, as in 'guests arrive in groups'.",
    ),
  lookOnly: z
    .boolean()
    .describe("True when the request only changes how the tool looks, not what it does."),
  targetsCurrentTool: z.boolean().describe("True when the request is about the tool open now."),
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .describe("The request's language as a BCP 47 tag, such as en or pt-BR (GEN-15)."),
  features: z
    .array(feature)
    .describe("The separate things the request asks for, used to decide on two passes (GEN-17)."),
  // Absent in answers recorded before profiles existed, which read as none.
  profile: profileIdSchema
    .nullable()
    .default(null)
    .describe(
      "The verification profile the tool fits once the request is done, from the list given; null when none fits or no tool is built or changed (VER-03).",
    ),
  // Absent in answers recorded before charts existed, which read as none.
  drawsCharts: z
    .boolean()
    .default(false)
    .describe(
      "True when the tool, once the request is done, shows a chart or graph, so it is told how to draw one (CAP-04).",
    ),
};

export const intentSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("open_saved"),
      savedToolId: z
        .string()
        .min(1)
        .describe("The ID of the saved tool the request matches, from the catalogue (GEN-18)."),
      ...common,
    }),
    z.strictObject({
      kind: z.enum(INTENT_KINDS).exclude(["open_saved"]),
      ...common,
    }),
  ])
  .describe("The intent stage's answer: what a request asks for, used to route it (GEN-01).");

/** The most a discussion's answer may say, in characters: a few short paragraphs (GEN-19). */
export const DISCUSSION_MAX_CHARACTERS = 1_500;

/** The discuss stage's answer (GEN-19): plain words for the person, and nothing built. */
export const discussionSchema = z
  .strictObject({
    answer: z
      .string()
      .trim()
      .min(1)
      .max(DISCUSSION_MAX_CHARACTERS)
      .describe("The answer to the question or idea, in plain words, in the person's language."),
  })
  .describe("The discuss stage's answer to a question or an idea about a tool (GEN-19).");
export type Discussion = z.infer<typeof discussionSchema>;

/**
 * An intent as the host passes it: `profile` may be left out, meaning none, as in answers recorded
 * before profiles existed.
 */
export type Intent = z.input<typeof intentSchema>;
