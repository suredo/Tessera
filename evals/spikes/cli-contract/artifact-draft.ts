import { z } from "zod";

// A stand-in for the generation stage's answer, only for this spike: a schema shaped like one
// (nested objects and arrays, a discriminated union as CON-02 asks, patterns and nullable fields)
// to send through --json-schema. The intent contract is the realistic-size one. The real
// generation contract is designed in M2 and lives in @tessera/contracts.

const file = z.strictObject({
  path: z
    .string()
    .regex(/^[a-z0-9-]+\.(html|css|js)$/)
    .describe("A file name such as index.html, styles.css or app.js."),
  content: z.string().describe("The whole file."),
});

const control = z.strictObject({
  hook: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .describe("A stable name tests use to find the control."),
  label: z.string().min(1),
  kind: z.enum(["button", "checkbox", "text", "number", "select"]),
});

export const artifactDraftSchema = z
  .strictObject({
    title: z.string().min(1).max(60),
    summary: z.string().min(1).describe("One or two plain sentences about what the tool does."),
    language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
    files: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("unchanged") }),
      z.strictObject({ mode: z.literal("replace"), files: z.array(file).min(1).max(3) }),
    ]),
    controls: z.array(control).describe("Every control a person can use, in screen order."),
    data: z.strictObject({
      fields: z.array(
        z.strictObject({
          name: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
          type: z.enum(["text", "number", "boolean", "date"]),
          unit: z.string().nullable().describe("The unit of a number, such as minutes; else null."),
        }),
      ),
      startCount: z.int().nonnegative().describe("How many records the tool starts with."),
    }),
  })
  .describe("Draft answer of a generation stage, for the CLI contract spike only.");
