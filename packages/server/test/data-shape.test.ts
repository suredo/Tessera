import type { Artifact, Migration } from "@tessera/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  checkToolData,
  compileToolSchema,
  migrateData,
  type DataShape,
} from "../src/data-shape/index.ts";
import type { ToolData } from "../src/patches/index.ts";
import { armTripwires, type Tripwires } from "./support/tripwires.ts";

// A tool's data shape (DATA-03, SEC-01): its declared schema is checked before it is compiled,
// and declarative migrations run on a copy, checked against both schemas. MIG-01 and MIG-02, the
// migration contract's refusals, are in the contracts package's artifact tests.

const task = {
  type: "object",
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    done: { type: "boolean" },
    size: { type: "number" },
  },
  additionalProperties: false,
};
const v1: DataShape = {
  schemaVersion: 1,
  schema: {
    type: "object",
    properties: {
      todo: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            state: { type: "string" },
            size: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
  },
};
const v2Schema = { type: "object", properties: { tasks: { type: "array", items: task } } };
const toV2: Migration = {
  fromVersion: 1,
  toVersion: 2,
  operations: [
    { op: "renameCollection", from: "todo", to: "tasks" },
    { op: "renameField", collection: "tasks", from: "name", to: "title" },
    {
      op: "mapValues",
      collection: "tasks",
      field: "state",
      map: [
        ["closed", true],
        ["open", false],
      ],
    },
    { op: "renameField", collection: "tasks", from: "state", to: "done" },
    { op: "addField", collection: "tasks", fields: { done: false } },
    { op: "setType", collection: "tasks", field: "size", to: "number" },
  ],
};
const target = (
  schemaVersion: number,
  schema: object,
  migrations: Migration[],
): Artifact["data"] => ({
  schemaVersion,
  schema: schema as Artifact["data"]["schema"],
  defaults: {},
  migrations,
});
const before: ToolData = {
  todo: [
    { id: "t-1", name: "Buy milk", state: "closed", size: "2" },
    { id: "t-2", name: "Call the bank", size: "1.5" },
  ],
};

describe("migrating a tool's data (DATA-03)", () => {
  it("runs every operation on a copy, and the result fits the new shape", () => {
    const result = migrateData(before, v1, target(2, v2Schema, [toV2]));
    expect(result).toEqual({
      ok: true,
      steps: 1,
      data: {
        tasks: [
          { id: "t-1", title: "Buy milk", done: true, size: 2 },
          { id: "t-2", title: "Call the bank", done: false, size: 1.5 },
        ],
      },
      // A value the table replaced is listed; renames, added fields and exact conversions aren't.
      losses: [{ path: ["tasks", "t-1", "state"], value: "closed" }],
    });
    // The data it was given is untouched.
    expect(before.todo).toHaveLength(2);
    expect((before.todo as { name: string }[])[0]!.name).toBe("Buy milk");
  });

  it("chains steps from the data's shape to the tool's, and says when a step is missing", () => {
    const v3Schema = {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: { ...task, properties: { ...task.properties, size: { type: "string" } } },
        },
      },
    };
    const toV3: Migration = {
      fromVersion: 2,
      toVersion: 3,
      operations: [{ op: "setType", collection: "tasks", field: "size", to: "string" }],
    };
    const result = migrateData(before, v1, target(3, v3Schema, [toV3, toV2]));
    expect(result).toMatchObject({ ok: true, steps: 2 });
    expect(result.ok && (result.data.tasks as { size: string }[])[1]!.size).toBe("1.5");

    expect(migrateData(before, v1, target(3, v3Schema, [toV3]))).toMatchObject({
      ok: false,
      reason: "no-path",
      message: "Nothing was changed: the tool has no migration from shape 1 to shape 2.",
    });
    expect(migrateData(before, { ...v1, schemaVersion: 4 }, target(3, v3Schema, []))).toMatchObject(
      {
        reason: "no-path",
      },
    );
  });

  it("refuses data that doesn't fit its own shape before migrating it", () => {
    const broken = { todo: [{ id: "t-1" }] };
    expect(migrateData(broken, v1, target(2, v2Schema, [toV2]))).toMatchObject({
      ok: false,
      reason: "invalid-source",
    });
  });

  it("MIG-03: a migration that fails half way, or whose result breaks the new shape, changes nothing", () => {
    const notANumber = { todo: [{ id: "t-1", name: "Buy milk", size: "two" }] };
    const stopped = migrateData(notANumber, v1, target(2, v2Schema, [toV2]));
    expect(stopped).toMatchObject({ ok: false, reason: "failed" });
    expect(!stopped.ok && stopped.message).toBe(
      'Nothing was changed: the migration stopped: "size" of the entry t-1 in "tasks" can\'t become a number without changing it.',
    );
    expect(notANumber).toEqual({ todo: [{ id: "t-1", name: "Buy milk", size: "two" }] });

    // Without the rename to "title", the result lacks a required field.
    const partial: Migration = {
      ...toV2,
      operations: toV2.operations.filter((o) => o.op !== "renameField"),
    };
    expect(migrateData(before, v1, target(2, v2Schema, [partial]))).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("converts text to a number only when the number stands for exactly that decimal", () => {
    const loose = { type: "object" };
    const sizes = (...values: string[]) => ({
      todo: values.map((size, i) => ({ id: `t-${i}`, size })),
    });
    const toNumber: Migration = {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "setType", collection: "todo", field: "size", to: "number" }],
    };
    const convert = (...values: string[]) =>
      migrateData(sizes(...values), { ...v1, schema: loose }, target(2, loose, [toNumber]));
    // Small decimals too, which JavaScript prints in exponent notation ("1e-7").
    const exact = convert(
      "12.50",
      "1.0",
      "0",
      "-3",
      "123456789012345",
      "0.0000001",
      "0.000000000000001",
    );
    expect(exact.ok && (exact.data.todo as { size: number }[]).map((t) => t.size)).toEqual([
      12.5, 1, 0, -3, 123456789012345, 1e-7, 1e-15,
    ]);
    for (const lossy of ["999999999999999.99", "0.1234567890123456", "-0", "1e3", "01"]) {
      expect(convert(lossy), lossy).toMatchObject({ ok: false, reason: "failed" });
    }
  });

  it("MIG-04: stops growth past the data limit as it happens, without building the whole result", () => {
    // One addField with 500 values of 1,000 characters, on 5,000 records: about 74 KB of data
    // that would grow towards 2.5 GB. The budget stops it at the first records.
    const records = { todo: Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}` })) };
    const fields = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`f${i}`, "x".repeat(1000)]),
    );
    const grow: Migration = {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "addField", collection: "todo", fields }],
    };
    const loose = { type: "object" };
    const started = performance.now();
    expect(migrateData(records, { ...v1, schema: loose }, target(2, loose, [grow]))).toMatchObject({
      ok: false,
      reason: "too-large",
    });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(records.todo[0]).toEqual({ id: "t0" });
  });

  it("MIG-04: refuses a result over the data limit, or one that differs between two runs", () => {
    const grow: Migration = {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "addField", collection: "todo", fields: { note: "x".repeat(1000) } }],
    };
    const many = { todo: Array.from({ length: 300 }, (_, i) => ({ id: `t-${i}`, name: "n" })) };
    const loose = { type: "object" };
    expect(migrateData(many, { ...v1, schema: loose }, target(2, loose, [grow]))).toMatchObject({
      ok: false,
      reason: "too-large",
    });
    let runs = 0;
    const unsteady = (data: ToolData) => ({ ...applyMigrations(data, [toV2]), run: (runs += 1) });
    expect(migrateData(before, v1, target(2, loose, [toV2]), unsteady)).toMatchObject({
      ok: false,
      reason: "not-repeatable",
    });
  });

  it("refuses a rename onto a list that exists, and a field that isn't a list of records", () => {
    const clash: Migration = {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "renameCollection", from: "todo", to: "tasks" }],
    };
    const loose = { type: "object" };
    expect(
      migrateData({ todo: [], tasks: [] }, { ...v1, schema: loose }, target(2, loose, [clash])),
    ).toMatchObject({ reason: "failed" });
    const notAList: Migration = {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "removeField", collection: "title", field: "x" }],
    };
    expect(
      migrateData({ title: "My errands" }, { ...v1, schema: loose }, target(2, loose, [notAList])),
    ).toMatchObject({ reason: "failed" });
  });

  describe("with tripwires on", () => {
    let wires: Tripwires | undefined;
    afterEach(() => wires?.disarm());

    it("MIG-05: a migration opens no connection, starts no process and touches no file", () => {
      // A schema not compiled before, so compiling it happens under the tripwires too.
      const fresh = { ...v2Schema, title: "A tool's data, version 2" };
      wires = armTripwires({ allowFolders: [] });
      const result = migrateData(before, v1, target(2, fresh, [toV2]));
      wires.disarm();
      expect(result.ok).toBe(true);
      expect(wires.trips).toEqual([]);
    });
  });
});

describe("a tool's declared schema (DATA-03)", () => {
  it("is compiled once it passes, and data is checked against it plainly", () => {
    expect(compileToolSchema(v2Schema).ok).toBe(true);
    expect(checkToolData(v2Schema, { tasks: [{ id: "t-1", title: "Tea" }] })).toEqual({ ok: true });
    expect(checkToolData(v2Schema, { tasks: [{ id: "t-1" }] })).toEqual({
      ok: false,
      reason:
        "The data doesn't fit the tool's shape at /tasks/0: must have required property 'title'.",
    });
  });

  it("accepts only keywords whose checking grows with the data, and refuses the rest before compiling", () => {
    const refused = (schema: object) => {
      const check = compileToolSchema(schema);
      return check.ok ? "compiled" : check.reason;
    };
    const text = (extra: object) => ({
      type: "object",
      properties: { text: { type: "string", ...extra } },
    });
    // A pattern can backtrack for ever on a short text, even with a maxLength.
    expect(refused(text({ maxLength: 64, pattern: "^(a+)+$" }))).toBe(
      "The tool's data schema/properties/text uses \"pattern\", which a tool's data schema can't use.",
    );
    expect(refused(text({ maxLength: 64, format: "email" }))).toMatch(/uses "format"/);
    // A reference to itself would recurse without end; one outside would need fetching.
    expect(refused({ $ref: "#" })).toMatch(/uses "\$ref"/);
    expect(refused({ $ref: "https://example.com/schema.json" })).toMatch(/uses "\$ref"/);
    expect(refused({ anyOf: [{ type: "string" }, { type: "number" }] })).toMatch(/uses "anyOf"/);
    expect(refused({ type: "array", uniqueItems: true })).toMatch(/uses "uniqueItems"/);
    expect(refused({ type: "array", items: [{ type: "string" }] })).toMatch(
      /lists items by position/,
    );
    expect(refused({ type: "object", madeUpKeyword: true })).toMatch(/uses "madeUpKeyword"/);
    expect(refused({ $schema: "https://json-schema.org/draft/2020-12/schema" })).toMatch(
      /draft-07/,
    );
    expect(refused({ enum: Array.from({ length: 1001 }, (_, i) => i) })).toMatch(/at most 1000/);
    let deep: object = { type: "string" };
    for (let i = 0; i < 40; i++) deep = { type: "array", items: deep };
    expect(refused(deep)).toMatch(/nested more than 32 levels/);
    const huge = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 3000 }, (_, i) => [`field${i}`, { type: "string" }]),
      ),
    };
    expect(refused(huge)).toMatch(/larger than Tessera accepts/);
    expect(
      refused({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["state"],
        properties: { state: { enum: ["open", "done"] }, note: { type: "string", maxLength: 200 } },
        additionalProperties: false,
      }),
    ).toBe("compiled");
  });

  it("refuses a schema nested thousands deep before anything recursive reads it", () => {
    // Valid JSON of 30 KB: 3,000 nested items, then a deep value inside a const.
    const deepItems = JSON.parse(`${'{"items":'.repeat(3000)}{}${"}".repeat(3000)}`) as object;
    expect(() => compileToolSchema(deepItems)).not.toThrow();
    expect(compileToolSchema(deepItems)).toEqual({
      ok: false,
      reason: "The tool's data schema is nested too deeply.",
    });
    const deepConst = JSON.parse(`{"const":${"[".repeat(3000)}${"]".repeat(3000)}}`) as object;
    expect(compileToolSchema(deepConst)).toMatchObject({ ok: false, reason: /nested too deeply/ });
  });

  it("takes a name objects inherit, such as constructor, as a field only when the data has it", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      const schema = { type: "object", required: [name] };
      expect(checkToolData(schema, {}).ok, name).toBe(false);
      expect(checkToolData(schema, { [name]: "here" }), name).toEqual({ ok: true });
    }
  });
});
