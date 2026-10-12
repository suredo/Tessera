import { z } from "zod";

// The intent stage's answer (GEN-01): what a request asks for, so the host can route it. A draft
// for the intent spike (#20); the generation pipeline (M2) settles it. Each kind is a branch of a
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

export type Intent = z.infer<typeof intentSchema>;
