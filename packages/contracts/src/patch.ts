import { z } from "zod";
import { jsonValueSchema, refusingReservedKey } from "./json.ts";

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

const patchOperationSchema = z
  .discriminatedUnion("op", [
    z
      .strictObject({
        op: z.literal("add"),
        collection: collectionName,
        record: z.record(fieldName, jsonValueSchema),
      })
      .describe("Adds a record; the host gives it its ID. Adds never conflict."),
    z
      .strictObject({
        op: z.literal("replace"),
        collection: collectionName,
        id: recordIdSchema,
        revisionCount,
        fields: z.record(fieldName, jsonValueSchema),
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

// zod's records silently drop a "__proto__" key while the JSON Schema refuses it, so the whole batch
// is refused before zod parses it, wherever the key is (CON-01).
export const patchBatchSchema = refusingReservedKey(
  z.strictObject({ operations: z.array(patchOperationSchema).min(1) }),
).describe("Changes applied in order, all or nothing (DATA-02).");
export type PatchBatch = z.infer<typeof patchBatchSchema>;
