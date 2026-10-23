import {
  patchBatchSchema,
  recordIdSchema,
  TOOL_DATA_LIMIT_BYTES,
  type PatchOperation,
} from "@tessera/contracts";
import type { z } from "zod";

// The patch engine (DATA-02, DATA-06): applies a batch of changes to a tool's data in memory.
// Each operation is resolved against a working copy left by the ones before it, so a removal
// never shifts which record a later one changes (L-23). The batch applies whole or not at all,
// and only a record it touches can make it stale. Storing the result is the caller's job.

type Json = z.infer<ReturnType<typeof z.json>>;
/** A tool's structured data: its top-level fields, where each list of records is a collection. */
export type ToolData = { [field: string]: Json };
type DataRecord = { id: string; [field: string]: Json };

/** A tool's data with each record's revision count, keyed by `collection/id`. */
export type DataState = Readonly<{ data: ToolData; revisions: ReadonlyMap<string, number> }>;

export type PatchRefusal = "invalid" | "stale" | "too-large";
export type PatchResult =
  | { ok: true; state: DataState; addedIds: string[] }
  | { ok: false; reason: PatchRefusal; message: string; operationIndex: number | null };

export type PatchOptions = {
  /** Gives each added record its ID; random by default. */
  newId?: () => string;
  /** The data limit; `TOOL_DATA_LIMIT_BYTES` by default (DATA-06). */
  limitBytes?: number;
};

/** The key a record's revision is kept under: its collection and its ID. */
export const recordKey = (collection: string, id: string) => `${collection}/${id}`;
/** The collection and ID a key names; a collection name never holds a "/". */
export const recordOfKey = (key: string): { collection: string; id: string } => ({
  collection: key.slice(0, key.indexOf("/")),
  id: key.slice(key.indexOf("/") + 1),
});

const isRecord = (value: unknown): value is DataRecord =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  recordIdSchema.safeParse((value as { id?: unknown }).id).success;

// A collection is a top-level list whose items all are records with an ID; `units: ["kg"]` isn't.
const isCollection = (value: unknown): value is DataRecord[] =>
  Array.isArray(value) && value.every(isRecord);

const sizeBytes = (data: ToolData) => new TextEncoder().encode(JSON.stringify(data)).byteLength;
const kb = (bytes: number) => Math.ceil(bytes / 1024);

/** Starts tracking a tool's data: every record it already holds is at revision 1. */
export function createDataState(data: ToolData): DataState {
  const revisions = new Map<string, number>();
  for (const [collection, value] of Object.entries(data)) {
    if (!isCollection(value)) continue;
    for (const record of value) {
      const key = recordKey(collection, record.id);
      if (revisions.has(key)) {
        throw new Error(`The tool's data has two entries in "${collection}" with ID ${record.id}.`);
      }
      revisions.set(key, 1);
    }
  }
  return { data: structuredClone(data), revisions };
}

/** A record's revision count, which a change planned against it carries; undefined if it's gone. */
export const revisionOf = (state: DataState, collection: string, id: string): number | undefined =>
  state.revisions.get(recordKey(collection, id));

/**
 * Applies a batch to a tool's data (DATA-02): checked against the patch contract, resolved one
 * operation at a time, then checked against the data limit (DATA-06). It never changes `state`:
 * it returns the new state, or a plain reason why nothing was applied.
 */
export function applyPatch(
  state: DataState,
  batch: unknown,
  options: PatchOptions = {},
): PatchResult {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const limitBytes = options.limitBytes ?? TOOL_DATA_LIMIT_BYTES;
  const refuse = (reason: PatchRefusal, detail: string, operationIndex: number | null) => ({
    ok: false as const,
    reason,
    message: `Nothing was changed: ${detail}`,
    operationIndex,
  });

  const parsed = patchBatchSchema.safeParse(batch);
  if (!parsed.success)
    return refuse("invalid", "the change isn't in a form Tessera accepts.", null);

  const data = structuredClone(state.data);
  const changed = new Set<string>();
  const removed = new Set<string>();
  const added: string[] = [];
  for (const [index, op] of parsed.data.operations.entries()) {
    const list = Object.hasOwn(data, op.collection) ? data[op.collection] : undefined;
    if (!isCollection(list)) {
      return refuse("invalid", `the tool's data has no list called "${op.collection}".`, index);
    }
    if (op.op === "add") {
      const id = newId();
      const key = recordKey(op.collection, id);
      if (
        !recordIdSchema.safeParse(id).success ||
        state.revisions.has(key) ||
        added.includes(key)
      ) {
        throw new Error(`The new record ID ${id} is invalid or already used.`);
      }
      list.push({ id, ...op.record });
      added.push(key);
      continue;
    }
    const target = resolve(state, list, op);
    if (target === "stale") {
      return refuse(
        "stale",
        `an entry in "${op.collection}" was changed or removed after this change was planned, and that newer edit is kept.`,
        index,
      );
    }
    if (target === "removed") {
      return refuse(
        "invalid",
        `the change edits an entry in "${op.collection}" that it removes earlier.`,
        index,
      );
    }
    const key = recordKey(op.collection, op.id);
    if (op.op === "remove") {
      list.splice(target, 1);
      removed.add(key);
    } else if (Object.keys(op.fields).length > 0) {
      list[target] = { ...list[target]!, ...op.fields };
      changed.add(key);
    }
  }

  const size = sizeBytes(data);
  // A change that makes data smaller is never refused, even data already over the limit.
  if (size > limitBytes && size > sizeBytes(state.data)) {
    return refuse(
      "too-large",
      `it would make the tool's data ${kb(size)} KB, over its limit of ${kb(limitBytes)} KB.`,
      null,
    );
  }

  const revisions = new Map(state.revisions);
  for (const key of changed) revisions.set(key, state.revisions.get(key)! + 1);
  for (const key of removed) revisions.delete(key);
  for (const key of added) revisions.set(key, 1);
  const addedIds = added.map((key) => recordOfKey(key).id);
  return { ok: true, state: { data, revisions }, addedIds };
}

// Where a replace or remove lands in the working copy: stale if its record changed after the
// change was planned (checked against the batch's starting state, so its own earlier operations
// don't count), or removed if an earlier operation in the batch removed it.
function resolve(
  state: DataState,
  list: DataRecord[],
  op: Exclude<PatchOperation, { op: "add" }>,
): number | "stale" | "removed" {
  if (state.revisions.get(recordKey(op.collection, op.id)) !== op.revisionCount) return "stale";
  const at = list.findIndex((record) => record.id === op.id);
  return at < 0 ? "removed" : at;
}
