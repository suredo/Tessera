import {
  canonicalJson,
  TOOL_DATA_LIMIT_BYTES,
  type Artifact,
  type Migration,
  type MigrationOperation,
} from "@tessera/contracts";
import type { ToolData } from "../patches/index.ts";
import { stepFor, type Loss } from "./project.ts";
import { checkToolData } from "./schema.ts";

// Migrating a tool's data to a newer shape (DATA-03): the declared operations, run on a copy,
// never code (SEC-01). The source data must fit its own schema, the result must fit the target's,
// stay within the data limit (DATA-06), and come out the same when run twice. Nothing here stores
// anything: activation (#50) commits the result, or keeps the committed unit.

/** The shape a tool's data is in: its schema version and the JSON Schema of that version. */
export type DataShape = { schemaVersion: number; schema: object };

export type MigrationRefusal =
  "invalid-source" | "no-path" | "failed" | "not-repeatable" | "too-large" | "invalid";

export type MigrationResult =
  | {
      ok: true;
      data: ToolData;
      steps: number;
      /** Every value the migrations removed or replaced: a restore must not drop them silently. */
      losses: Loss[];
    }
  | { ok: false; reason: MigrationRefusal; message: string };

class MigrationFailed extends Error {}

type DataRecord = { id?: unknown; [field: string]: unknown };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// A collection's records, or none when the data has no list by that name. A field that isn't a
// list of objects can't be migrated as one.
function recordsOf(data: ToolData, collection: string): DataRecord[] {
  if (!Object.hasOwn(data, collection)) return [];
  const list = data[collection];
  if (!Array.isArray(list) || !list.every(isPlainObject)) {
    throw new MigrationFailed(`"${collection}" isn't a list of records.`);
  }
  return list as DataRecord[];
}

const named = (record: DataRecord) =>
  typeof record.id === "string" ? `the entry ${record.id}` : "an entry";

// A text that is a plain decimal number, and the number only if it stands for exactly that
// decimal: "12.50" is 12.5, but "999999999999999.99" would be rounded, and "-0" loses its sign.
const PLAIN_NUMBER = /^-?(0|[1-9]\d{0,14})(\.\d{1,15})?$/;
function exactNumber(text: string): number | undefined {
  if (!PLAIN_NUMBER.test(text)) return undefined;
  const number = Number(text);
  return plainDecimal(String(number)) === plainDecimal(text) ? number : undefined;
}

// A number's text as a plain decimal, whatever notation it is written in: "1e-7" and
// "0.00000010" are both "0.0000001", so values are compared, not how JavaScript prints them.
function plainDecimal(text: string): string {
  const [, sign = "", whole = "", fraction = "", exponent = "0"] =
    /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text) ?? [];
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  const placed =
    point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer = "", decimals = ""] = placed.split(".");
  const trimmed =
    (integer.replace(/^0+(?=\d)/, "") || "0") +
    (decimals.replace(/0+$/, "") ? `.${decimals.replace(/0+$/, "")}` : "");
  return sign + trimmed;
}

/** Thrown when a migration's result would grow past the data limit, before it gets there. */
class MigrationTooLarge extends Error {}
/** The most a loss preview may hold, as UTF-8 JSON: as much as the data itself may. */
export const LOSS_PREVIEW_LIMIT_BYTES = TOOL_DATA_LIMIT_BYTES;

// One field a record held before the run: where it was, what it held, and where it is now.
type Origin = {
  /** Its path before the run: collection, the record's ID (or position), field. */
  path: string[];
  /** What it held before the run. */
  original: Loss["value"];
  /** What it should hold now if nothing was lost: the original, or its exact conversion. */
  expected: Loss["value"];
  record: DataRecord;
  field: string;
  removed: boolean;
};

/**
 * What a run loses, for a restore's preview, followed by where each original value came from
 * rather than by paths: a field a later step reuses is a different field. Each field a record
 * holds before the run gets an origin. A rename moves the origin with its value; removing the
 * field loses it for good, whatever a later step adds there; an exact conversion keeps it. At the
 * end, an origin is lost if it was removed, or if its value now differs from what it should hold:
 * a value replaced and then replaced back is no loss. There is at most one origin per field of
 * the data, so the log is as bounded as the data, and a preview larger than
 * `LOSS_PREVIEW_LIMIT_BYTES` is a refusal, never cut short.
 */
export class LossLog {
  private readonly origins: Origin[] = [];
  private readonly byRecord = new WeakMap<object, Map<string, Origin>>();

  /** Gives every field of every record in `data`, the run's copy, an origin. */
  begin(data: ToolData) {
    for (const [collection, list] of Object.entries(data)) {
      if (!Array.isArray(list) || !list.every(isPlainObject)) continue;
      for (const [index, record] of (list as DataRecord[]).entries()) {
        const fields = new Map<string, Origin>();
        for (const [field, value] of Object.entries(record)) {
          if (field === "id") continue;
          const origin: Origin = {
            path: [collection, stepFor(record, index), field],
            original: value as Loss["value"],
            expected: value as Loss["value"],
            record,
            field,
            removed: false,
          };
          fields.set(field, origin);
          this.origins.push(origin);
        }
        this.byRecord.set(record, fields);
      }
    }
  }
  moved(record: DataRecord, from: string, to: string) {
    const fields = this.byRecord.get(record);
    const origin = fields?.get(from);
    if (!fields || !origin) return;
    fields.delete(from);
    origin.field = to;
    fields.set(to, origin);
  }
  removed(record: DataRecord, field: string) {
    const fields = this.byRecord.get(record);
    const origin = fields?.get(field);
    if (!fields || !origin) return;
    origin.removed = true;
    fields.delete(field);
  }
  converted(record: DataRecord, field: string, value: unknown) {
    const origin = this.byRecord.get(record)?.get(field);
    if (origin && canonicalJson(record[field]) === canonicalJson(origin.expected)) {
      origin.expected = value as Loss["value"];
    }
  }
  /** Every original value the run lost, or null if they are more than a preview may hold. */
  settle(): Loss[] | null {
    const losses: Loss[] = [];
    let bytes = 0;
    for (const origin of this.origins) {
      const kept =
        !origin.removed &&
        canonicalJson(origin.record[origin.field]) === canonicalJson(origin.expected);
      if (kept) continue;
      bytes +=
        Buffer.byteLength(JSON.stringify(origin.path), "utf8") +
        Buffer.byteLength(JSON.stringify(origin.original), "utf8");
      if (bytes > LOSS_PREVIEW_LIMIT_BYTES) return null;
      losses.push({ path: origin.path, value: origin.original });
    }
    return losses;
  }
}

// The result's size as JSON, kept exactly as each change is made, so growth past the limit stops
// at once instead of after the whole result is built. A field in an object is written as
// `"name":value`, with a comma before it unless it is the first.
class SizeBudget {
  private bytes: number;
  private readonly limitBytes: number;
  constructor(bytes: number, limitBytes: number) {
    this.bytes = bytes;
    this.limitBytes = limitBytes;
  }
  static jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  private static fieldBytes = (name: string, value: unknown, alone: boolean) =>
    SizeBudget.jsonBytes(name) + 1 + SizeBudget.jsonBytes(value) + (alone ? 0 : 1);
  change(delta: number) {
    this.bytes += delta;
    if (this.bytes > this.limitBytes) throw new MigrationTooLarge();
  }
  added(record: object, name: string, value: unknown) {
    this.change(SizeBudget.fieldBytes(name, value, Object.keys(record).length === 0));
  }
  removed(record: object, name: string, value: unknown) {
    this.change(-SizeBudget.fieldBytes(name, value, Object.keys(record).length === 1));
  }
  replaced(before: unknown, after: unknown) {
    this.change(SizeBudget.jsonBytes(after) - SizeBudget.jsonBytes(before));
  }
}

// One operation, applied in place to a copy that belongs to the run, with each change counted in
// the budget, and each value it removes or replaces listed in `losses`. Renames and added fields
// lose nothing, and setType only converts exactly. Field and collection names are the contract's
// (letters first, never `id`), so no name reaches what objects inherit.
function applyOperation(
  data: ToolData,
  op: MigrationOperation,
  budget: SizeBudget,
  losses: LossLog | undefined,
): void {
  if (op.op === "renameCollection") {
    if (!Object.hasOwn(data, op.from)) return;
    if (Object.hasOwn(data, op.to)) {
      throw new MigrationFailed(`the data already has a list called "${op.to}".`);
    }
    recordsOf(data, op.from);
    budget.replaced(op.from, op.to);
    data[op.to] = data[op.from]!;
    delete data[op.from];
    return;
  }
  for (const record of recordsOf(data, op.collection)) {
    switch (op.op) {
      case "renameField":
        if (!Object.hasOwn(record, op.from)) break;
        if (Object.hasOwn(record, op.to)) {
          throw new MigrationFailed(
            `${named(record)} in "${op.collection}" already has "${op.to}".`,
          );
        }
        budget.replaced(op.from, op.to);
        losses?.moved(record, op.from, op.to);
        record[op.to] = record[op.from];
        delete record[op.from];
        break;
      case "addField":
        for (const [field, value] of Object.entries(op.fields)) {
          if (Object.hasOwn(record, field)) continue;
          budget.added(record, field, value);
          record[field] = value;
        }
        break;
      case "removeField":
        if (!Object.hasOwn(record, op.field)) break;
        budget.removed(record, op.field, record[op.field]);
        losses?.removed(record, op.field);
        delete record[op.field];
        break;
      case "mapValues": {
        if (!Object.hasOwn(record, op.field)) break;
        const pair = op.map.find(([from]) => from === record[op.field]);
        if (!pair || pair[1] === record[op.field]) break;
        budget.replaced(record[op.field], pair[1]);
        record[op.field] = pair[1];
        break;
      }
      case "setType": {
        if (!Object.hasOwn(record, op.field)) break;
        const value: unknown = record[op.field];
        let converted: unknown = value;
        if (op.to === "string" && typeof value === "number") converted = String(value);
        else if (op.to === "number" && typeof value === "string") converted = exactNumber(value);
        if (typeof converted !== op.to) {
          throw new MigrationFailed(
            `"${op.field}" of ${named(record)} in "${op.collection}" can't become a ${op.to} without changing it.`,
          );
        }
        budget.replaced(value, converted);
        losses?.converted(record, op.field, converted);
        record[op.field] = converted;
        break;
      }
    }
  }
}

/**
 * Runs migrations in order on a copy of `data`; the copy is the result. It stops, throwing, as
 * soon as the result would grow past `limitBytes`, or past the data's own size if that is larger.
 */
export function applyMigrations(
  data: ToolData,
  migrations: readonly Migration[],
  losses?: LossLog,
  limitBytes = TOOL_DATA_LIMIT_BYTES,
): ToolData {
  const copy = structuredClone(data);
  losses?.begin(copy);
  const size = SizeBudget.jsonBytes(copy);
  const budget = new SizeBudget(size, Math.max(limitBytes, size));
  for (const migration of migrations) {
    for (const op of migration.operations) applyOperation(copy, op, budget, losses);
  }
  return copy;
}

// The migrations that lead from one schema version to another, one step at a time.
function pathBetween(from: number, to: Artifact["data"]): Migration[] | string {
  if (from > to.schemaVersion) {
    return `the data's shape (version ${from}) is newer than the tool's (version ${to.schemaVersion}).`;
  }
  const steps: Migration[] = [];
  for (let version = from; version < to.schemaVersion; version += 1) {
    const step = to.migrations.find(
      (m) => m.fromVersion === version && m.toVersion === version + 1,
    );
    if (!step) return `the tool has no migration from shape ${version} to shape ${version + 1}.`;
    steps.push(step);
  }
  return steps;
}

const sizeBytes = (data: ToolData) => Buffer.byteLength(JSON.stringify(data), "utf8");

/**
 * Migrates a tool's data from the shape it is in to the tool version's (DATA-03). It checks the
 * data against its own schema first, runs the migrations twice on separate copies and compares
 * them, then checks the size and the target schema. With `trackLosses`, a restore's choice, it also
 * lists what the migrations remove or replace, within a bounded preview; activation doesn't need
 * it. `run` is the migration step itself; tests replace it to show what is refused.
 */
export function migrateData(
  data: ToolData,
  from: DataShape,
  to: Artifact["data"],
  options: {
    trackLosses?: boolean;
    run?: (data: ToolData, migrations: readonly Migration[], losses?: LossLog) => ToolData;
  } = {},
): MigrationResult {
  const run = options.run ?? applyMigrations;
  const refuse = (reason: MigrationRefusal, detail: string): MigrationResult => ({
    ok: false,
    reason,
    message: `Nothing was changed: ${detail}`,
  });
  const source = checkToolData(from.schema, data);
  if (!source.ok)
    return refuse("invalid-source", `the current data doesn't fit its own shape. ${source.reason}`);
  const steps = pathBetween(from.schemaVersion, to);
  if (typeof steps === "string") return refuse("no-path", steps);

  const log = options.trackLosses ? new LossLog() : undefined;
  let first: ToolData;
  let second: ToolData;
  try {
    first = run(data, steps, log);
    second = run(data, steps);
  } catch (error) {
    if (error instanceof MigrationFailed) {
      return refuse("failed", `the migration stopped: ${error.message}`);
    }
    if (error instanceof MigrationTooLarge) {
      return refuse(
        "too-large",
        `the migrated data would be over the limit of ${TOOL_DATA_LIMIT_BYTES / 1024} KB.`,
      );
    }
    throw error;
  }
  if (canonicalJson(first) !== canonicalJson(second)) {
    return refuse("not-repeatable", "the migration gave two different results from the same data.");
  }
  const size = sizeBytes(first);
  if (size > TOOL_DATA_LIMIT_BYTES && size > sizeBytes(data)) {
    return refuse(
      "too-large",
      `the migrated data would be ${Math.ceil(size / 1024)} KB, over the limit of ${TOOL_DATA_LIMIT_BYTES / 1024} KB.`,
    );
  }
  const target = checkToolData(to.schema, first);
  if (!target.ok)
    return refuse("invalid", `the migrated data wouldn't fit the new shape. ${target.reason}`);
  const losses = log ? log.settle() : [];
  if (losses === null) {
    return refuse(
      "too-large",
      `the migration would remove or replace more than a preview of it can list (${LOSS_PREVIEW_LIMIT_BYTES / 1024} KB).`,
    );
  }
  return { ok: true, data: first, steps: steps.length, losses };
}
