import { z } from "zod";
import { jsonObjectSchema, recordIdSchema } from "@tessera/contracts";
import { recordKey, type DataState, type ToolData } from "../patches/index.ts";

// What a data change keeps so it can be undone (DATA-04), and what undoing it gives. Pure: the
// workspaces module saves an entry with each change and applies an undo in its own transaction.

type DataRecord = { id: string } & Record<string, unknown>;

// One record a change touched: what it was before (null if the change added it), where it stood
// in its collection, and its revision just before and just after (null where it didn't exist). A
// removed record keeps its last revision in the saved rows, so its revision before also tells
// whether it came back and changed since.
const touchedSchema = z.strictObject({
  collection: z.string(),
  id: recordIdSchema,
  before: jsonObjectSchema.nullable(),
  beforeIndex: z.int().nonnegative().nullable(),
  revisionBefore: z.int().min(1).nullable(),
  revisionAfter: z.int().min(1).nullable(),
});

/**
 * A change to a tool's data: the records a patch touched, or, for data replaced whole, the data
 * before it.
 */
export const undoChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("records"), records: z.array(touchedSchema).min(1) }),
  z.strictObject({ kind: z.literal("whole"), before: jsonObjectSchema.nullable() }),
]);
export type UndoChange = z.infer<typeof undoChangeSchema>;

const recordsOf = (data: ToolData, collection: string): DataRecord[] => {
  const list = data[collection];
  return Array.isArray(list) ? (list as DataRecord[]) : [];
};

/** What a patch changed, from the data before and after it; undefined if it changed no record. */
export function changeOfPatch(before: DataState, after: DataState): UndoChange | undefined {
  const keys = new Set([...before.revisions.keys(), ...after.revisions.keys()]);
  const records: z.infer<typeof touchedSchema>[] = [];
  for (const key of keys) {
    if (before.revisions.get(key) === after.revisions.get(key)) continue;
    const collection = key.slice(0, key.lastIndexOf("/"));
    const id = key.slice(key.lastIndexOf("/") + 1);
    const list = recordsOf(before.data, collection);
    const index = list.findIndex((record) => record.id === id);
    records.push({
      collection,
      id,
      before: index === -1 ? null : (list[index] as z.infer<typeof jsonObjectSchema>),
      beforeIndex: index === -1 ? null : index,
      revisionBefore: before.revisions.get(key) ?? null,
      revisionAfter: after.revisions.get(key) ?? null,
    });
  }
  return records.length > 0 ? { kind: "records", records } : undefined;
}

export type Undone =
  { ok: true; data: ToolData; restored: string[] } | { ok: false; reason: "stale" };

/**
 * The data with a records change undone, if every record it touched is still as the change left
 * it, at the same revision; otherwise stale, and nothing is undone. A record the change removed
 * must still be gone and still at the revision it had then, in `saved`, the saved revision of
 * every record the workspace has held: one that came back, changed and went again is refused.
 * `restored` are the keys of the records it brings back or changes back, which move to their next
 * revision.
 */
export function undoRecords(
  change: Extract<UndoChange, { kind: "records" }>,
  current: DataState,
  saved: ReadonlyMap<string, number>,
): Undone {
  for (const record of change.records) {
    const key = recordKey(record.collection, record.id);
    const now = current.revisions.get(key) ?? null;
    if (now !== record.revisionAfter) return { ok: false, reason: "stale" };
    if (record.revisionAfter === null && (saved.get(key) ?? null) !== record.revisionBefore) {
      return { ok: false, reason: "stale" };
    }
  }
  const data = structuredClone(current.data);
  const restored: string[] = [];
  // Put back removed records in the order they stood, so each lands where it was.
  const ordered = [...change.records].sort((a, b) => (a.beforeIndex ?? 0) - (b.beforeIndex ?? 0));
  for (const record of ordered) {
    const list = [...recordsOf(data, record.collection)];
    const at = list.findIndex((item) => item.id === record.id);
    if (record.before === null) {
      // The change added it: take it out.
      list.splice(at, 1);
    } else if (at === -1) {
      // The change removed it: bring it back where it stood.
      list.splice(
        Math.min(record.beforeIndex ?? list.length, list.length),
        0,
        record.before as DataRecord,
      );
      restored.push(recordKey(record.collection, record.id));
    } else {
      // The change replaced it: change it back, in place.
      list[at] = record.before as DataRecord;
      restored.push(recordKey(record.collection, record.id));
    }
    data[record.collection] = list as ToolData[string];
  }
  return { ok: true, data, restored };
}
