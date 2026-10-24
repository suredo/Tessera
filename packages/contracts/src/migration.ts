import { z } from "zod";
import { refusingReservedKey } from "./json.ts";
import { collectionName, fieldName } from "./patch.ts";

// A migration of a tool's data from one shape to the next (DATA-03): declarative operations only,
// never code (SEC-01). Each applies to every record of one collection, or renames a collection.
// What they do with each record is the server's to run, on a copy (docs/code/server/data-shape.md).

/** The most operations one migration may hold. */
export const MIGRATION_MAX_OPERATIONS = 50;
/** The most value pairs one `mapValues` may hold. */
export const MIGRATION_MAX_MAPPINGS = 100;

// A value a field holds that a mapping can match or set: not a list or an object.
const scalar = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);

const migrationOperationSchema = z
  .discriminatedUnion("op", [
    z
      .strictObject({ op: z.literal("renameCollection"), from: collectionName, to: collectionName })
      .describe("Renames a top-level list of records."),
    z
      .strictObject({
        op: z.literal("renameField"),
        collection: collectionName,
        from: fieldName,
        to: fieldName,
      })
      .describe("Renames a field in every record of a collection."),
    // Values are named by the tool's own fields, in a map, as a patch's are: the tool's field
    // names carry any unit (CON-05).
    z
      .strictObject({
        op: z.literal("addField"),
        collection: collectionName,
        fields: z.record(fieldName, scalar),
      })
      .describe("Gives every record of a collection that lacks one of these fields its value."),
    z
      .strictObject({ op: z.literal("removeField"), collection: collectionName, field: fieldName })
      .describe("Removes a field from every record of a collection."),
    z
      .strictObject({
        op: z.literal("mapValues"),
        collection: collectionName,
        field: fieldName,
        map: z
          .array(z.tuple([scalar, scalar]))
          .min(1)
          .max(MIGRATION_MAX_MAPPINGS)
          .describe("Pairs of an old value and the new value that replaces it."),
      })
      .describe("Replaces values of a field by a table of pairs; values not in it stay."),
    z
      .strictObject({
        op: z.literal("setType"),
        collection: collectionName,
        field: fieldName,
        to: z.enum(["string", "number"]),
      })
      .describe(
        "Converts a field: a number to its text, or a text of a plain number to the number.",
      ),
  ])
  .describe("One declarative change to a tool's data shape (DATA-03).");
export type MigrationOperation = z.infer<typeof migrationOperationSchema>;

/** A migration from one schema version of a tool's data to the next. */
export const migrationSchema = refusingReservedKey(
  z.strictObject({
    fromVersion: z.int().min(1),
    toVersion: z.int().min(2),
    operations: z.array(migrationOperationSchema).min(1).max(MIGRATION_MAX_OPERATIONS),
  }),
).describe("A tool's data, from one schema version to the next, as declarative operations.");
export type Migration = z.infer<typeof migrationSchema>;
