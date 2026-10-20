import { z } from "zod";

// A batch of data changes (DATA-02): small operations on records with stable IDs, resolved one at
// a time and applied all or nothing. A record is an object in a top-level list of the tool's data,
// such as `tasks`, and its `id` is given by the host, never by the change.

/** The most structured data one tool may hold, as UTF-8 JSON (DATA-06). */
export const TOOL_DATA_LIMIT_BYTES = 256 * 1024;

const collectionName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .describe("The top-level list the record is in, such as `tasks`.");
// A field name can't be `id`, which only the host sets, and starts with a letter, so never `__proto__`.
const fieldName = z.string().regex(/^(?!id$)[A-Za-z][A-Za-z0-9_]{0,63}$/);

export const recordIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("A record's stable ID, given by the host when it was added.");

const revisionCount = z
  .int()
  .min(1)
  .describe(
    "The record's revision count when this change was planned; the whole batch is refused if it has changed since (DATA-02).",
  );

// Any JSON value, but no object key anywhere may be `__proto__`. zod's records silently drop that
// key while the JSON Schema refuses it, so the batch refuses it before zod parses (CON-01).
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string().regex(/^(?!__proto__$)/), jsonValue),
  ]),
);
const hasProtoKey = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  (Object.hasOwn(value, "__proto__") || Object.values(value).some(hasProtoKey));

const patchOperationSchema = z
  .discriminatedUnion("op", [
    z
      .strictObject({
        op: z.literal("add"),
        collection: collectionName,
        record: z.record(fieldName, jsonValue),
      })
      .describe("Adds a record; the host gives it its ID. Adds never conflict."),
    z
      .strictObject({
        op: z.literal("replace"),
        collection: collectionName,
        id: recordIdSchema,
        revisionCount,
        fields: z.record(fieldName, jsonValue),
      })
      .describe("Sets the named fields of one record and keeps the rest: never a whole record."),
    z
      .strictObject({
        op: z.literal("remove"),
        collection: collectionName,
        id: recordIdSchema,
        revisionCount,
      })
      .describe("Removes one record."),
  ])
  .describe("One change to a tool's data (DATA-02).");
export type PatchOperation = z.infer<typeof patchOperationSchema>;

export const patchBatchSchema = z
  .preprocess(
    (batch, ctx) => {
      if (hasProtoKey(batch)) ctx.addIssue({ code: "custom", message: "No key may be __proto__." });
      return batch;
    },
    z.strictObject({ operations: z.array(patchOperationSchema).min(1) }),
  )
  .describe("Changes applied in order, all or nothing (DATA-02).");
export type PatchBatch = z.infer<typeof patchBatchSchema>;
