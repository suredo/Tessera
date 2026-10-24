import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { patchBatchSchema, toJsonSchema, type PatchBatch } from "../src/index.ts";

// zod (the host's check) and the generated JSON Schema must agree on every sample (CON-01).
const validateWithJsonSchema = new Ajv({ strict: true }).compile(toJsonSchema("patchBatch"));

const batch: PatchBatch = {
  operations: [
    { op: "add", collection: "tasks", record: { title: "Buy milk", done: false } },
    { op: "replace", collection: "tasks", id: "t-1", revisionCount: 2, fields: { done: true } },
    { op: "remove", collection: "tasks", id: "t_2", revisionCount: 1 },
  ],
};

describe("patch contract (DATA-02, CON-01)", () => {
  it("accepts a batch in zod and in its JSON Schema alike", () => {
    expect(patchBatchSchema.safeParse(batch).success).toBe(true);
    expect(validateWithJsonSchema(batch)).toBe(true);
  });

  it("refuses the same broken batches in zod and in its JSON Schema", () => {
    const [add, replace, remove] = batch.operations;
    const broken: unknown[] = [
      { operations: [] },
      { operations: [add], extra: true },
      { operations: [{ ...add, record: { id: "mine", title: "x" } }] },
      { operations: [{ ...replace, fields: { id: "z" } }] },
      { operations: [{ ...replace, fields: { done: true }, field: "done" }] },
      { operations: [{ ...replace, revisionCount: 0 }] },
      { operations: [{ op: "replace", collection: "tasks", id: "t-1", fields: { done: 1 } }] },
      { operations: [{ ...remove, id: "../other" }] },
      { operations: [{ ...remove, id: "__proto__" }] },
      { operations: [{ ...remove, collection: "1tasks" }] },
      { operations: [{ op: "move", collection: "tasks", id: "t-1", revisionCount: 1 }] },
    ];
    for (const sample of broken) {
      expect(patchBatchSchema.safeParse(sample).success, JSON.stringify(sample)).toBe(false);
      expect(validateWithJsonSchema(sample), JSON.stringify(sample)).toBe(false);
    }
  });

  it("refuses a __proto__ key anywhere in zod and in its JSON Schema alike, and sets no prototype", () => {
    const samples = [
      '{"operations":[{"op":"add","collection":"tasks","record":{"__proto__":{"polluted":true}}}]}',
      '{"operations":[{"op":"add","collection":"tasks","record":{"meta":{"__proto__":1}}}]}',
      '{"operations":[{"op":"replace","collection":"tasks","id":"a","revisionCount":1,"fields":{"__proto__":1}}]}',
      '{"operations":[{"op":"replace","collection":"tasks","id":"a","revisionCount":1,"fields":{"tags":[{"__proto__":1}]}}]}',
      '{"operations":[{"op":"remove","collection":"tasks","id":"a","revisionCount":1,"__proto__":1}]}',
      '{"__proto__":1,"operations":[{"op":"remove","collection":"tasks","id":"a","revisionCount":1}]}',
    ];
    for (const text of samples) {
      const sample = JSON.parse(text) as unknown;
      expect(patchBatchSchema.safeParse(sample).success, text).toBe(false);
      expect(validateWithJsonSchema(sample), text).toBe(false);
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("keeps nested values whole: any JSON without a __proto__ key passes both validators unchanged", () => {
    const sample = {
      operations: [
        {
          op: "add",
          collection: "tasks",
          record: { meta: { tags: ["a", 1, null, { proto: true }] } },
        },
      ],
    };
    expect(patchBatchSchema.parse(sample)).toEqual(sample);
    expect(validateWithJsonSchema(sample)).toBe(true);
  });
});
