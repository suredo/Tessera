import { z } from "zod";

// The trash (DATA-09): a deleted workspace or saved tool waits here, restorable, for 30 days, and
// is then removed for good. Emptying it early is confirmed against the list the person saw.

/** How long a deleted workspace or saved tool can be restored (A31). */
export const TRASH_RETENTION_DAYS = 30;

const entry = {
  id: z.uuid(),
  name: z.string().min(1).max(200).describe("The workspace's title or the saved tool's name."),
  deletedAt: z.iso.datetime(),
  removedAt: z.iso.datetime().describe("When it is removed for good, unless restored before."),
};

export const trashEntrySchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("workspace"),
      ...entry,
      savedTools: z
        .array(z.string())
        .describe(
          "The names of the saved tools that went to the trash with it, and come back with it.",
        ),
    }),
    z.strictObject({ kind: z.literal("savedTool"), ...entry }),
  ])
  .describe("A deleted workspace or saved tool, restorable until it is removed (DATA-09).");
export type TrashEntry = z.infer<typeof trashEntrySchema>;

export const trashSchema = z
  .strictObject({
    entries: z.array(trashEntrySchema).describe("The most recently deleted first."),
    confirmation: z
      .string()
      .describe(
        "Empties exactly these entries; if the trash changed since, emptying it is refused.",
      ),
  })
  .describe("What is in the trash, and what emptying it now would remove (DATA-09).");
export type Trash = z.infer<typeof trashSchema>;
