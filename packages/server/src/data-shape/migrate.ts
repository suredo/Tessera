import {
  canonicalJson,
  TOOL_DATA_LIMIT_BYTES,
  type Artifact,
  type Migration,
  type MigrationOperation,
} from "@tessera/contracts";
import type { ToolData } from "../patches/index.ts";
import type { Loss } from "./project.ts";
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
/** Thrown when what a migration drops is more than a preview of it may hold. */
class TooManyLosses extends Error {}

/** The most a loss preview may hold, as UTF-8 JSON: as much as the data itself may. */
export const LOSS_PREVIEW_LIMIT_BYTES = TOOL_DATA_LIMIT_BYTES;

/**
 * What a run removes or replaces, for a restore's preview. Each place is listed once, with the
 * value it held before the run: a value replaced again and again is one loss, not many. It counts
 * its own size and stops the run once that passes `LOSS_PREVIEW_LIMIT_BYTES`, so it never holds
 * more than a preview can show; a restore that would lose more is refused, never cut short.
 */
export class LossLog {
  private readonly byPlace = new Map<string, Loss>();
  private bytes = 0;
  add(path: string[], value: Loss["value"]) {
    const place = JSON.stringify(path);
    if (this.byPlace.has(place)) return;
    this.bytes +=
      Buffer.byteLength(place, "utf8") + Buffer.byteLength(JSON.stringify(value), "utf8");
    if (this.bytes > LOSS_PREVIEW_LIMIT_BYTES) throw new TooManyLosses();
    this.byPlace.set(place, { path, value });
  }
  /** The losses, without those whose place holds the same value again in `result`. */
  settle(result: ToolData): Loss[] {
    return [...this.byPlace.values()].filter(
      (loss) => canonicalJson(valueAt(result, loss.path)) !== canonicalJson(loss.value),
    );
  }
}

// The value at a loss's path in some data: a collection, a record named by ID or position, a field.
function valueAt(data: ToolData, [collection = "", step = "", field = ""]: string[]): unknown {
  const list = Object.hasOwn(data, collection) ? data[collection] : undefined;
  if (!Array.isArray(list)) return undefined;
  const byId = list.find((r) => isPlainObject(r) && r["id"] === step);
  const record = byId ?? list[Number(step)];
  return isPlainObject(record) && Object.hasOwn(record, field) ? record[field] : undefined;
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

// How a record is named in a loss's path: its ID when it has one, else its position.
const stepFor = (record: DataRecord, index: number) =>
  typeof record.id === "string" ? record.id : String(index);

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
  for (const [index, record] of recordsOf(data, op.collection).entries()) {
    const at = (field: string) => [op.collection, stepFor(record, index), field];
    switch (op.op) {
      case "renameField":
        if (!Object.hasOwn(record, op.from)) break;
        if (Object.hasOwn(record, op.to)) {
          throw new MigrationFailed(
            `${named(record)} in "${op.collection}" already has "${op.to}".`,
          );
        }
        budget.replaced(op.from, op.to);
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
        losses?.add(at(op.field), record[op.field] as Loss["value"]);
        delete record[op.field];
        break;
      case "mapValues": {
        if (!Object.hasOwn(record, op.field)) break;
        const pair = op.map.find(([from]) => from === record[op.field]);
        if (!pair || pair[1] === record[op.field]) break;
        budget.replaced(record[op.field], pair[1]);
        losses?.add(at(op.field), record[op.field] as Loss["value"]);
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
    if (error instanceof TooManyLosses) {
      return refuse(
        "too-large",
        `the migration would remove or replace more than a preview of it can list (${LOSS_PREVIEW_LIMIT_BYTES / 1024} KB).`,
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
  return { ok: true, data: first, steps: steps.length, losses: log ? log.settle(first) : [] };
}
