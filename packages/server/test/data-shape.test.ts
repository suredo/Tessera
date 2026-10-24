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
      'Nothing was changed: the migration stopped: "size" of the entry t-1 in "tasks" can\'t become a number.',
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

  it("refuses a schema that could make checking slow, or that it can't use, before compiling it", () => {
    const refused = (schema: object) => {
      const check = compileToolSchema(schema);
      return check.ok ? "compiled" : check.reason;
    };
    expect(refused({ type: "string", pattern: "^(a+)+$" })).toMatch(/could make checking slow/);
    expect(refused({ type: "string", format: "email" })).toMatch(/could make checking slow/);
    expect(refused({ type: "object", madeUpKeyword: true })).toMatch(/isn't a JSON Schema/);
    expect(refused({ $ref: "https://example.com/schema.json" })).toMatch(/isn't a JSON Schema/);
    const huge = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 3000 }, (_, i) => [`field${i}`, { type: "string" }]),
      ),
    };
    expect(refused(huge)).toMatch(/larger than Tessera accepts/);
    expect(refused({ type: "string", pattern: "^[a-z]+$", maxLength: 40 })).toBe("compiled");
  });

  it("keeps two tools' schemas apart, even with the same $id", () => {
    const a = { $id: "https://tool.example/data", type: "object", required: ["a"] };
    const b = { $id: "https://tool.example/data", type: "object", required: ["b"] };
    expect(checkToolData(a, { a: 1 })).toEqual({ ok: true });
    expect(checkToolData(b, { b: 1 })).toEqual({ ok: true });
    expect(checkToolData(b, { a: 1 }).ok).toBe(false);
  });
});
