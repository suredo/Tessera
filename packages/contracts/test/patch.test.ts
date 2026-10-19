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
      { operations: [{ ...remove, collection: "1tasks" }] },
      { operations: [{ op: "move", collection: "tasks", id: "t-1", revisionCount: 1 }] },
    ];
    for (const sample of broken) {
      expect(patchBatchSchema.safeParse(sample).success, JSON.stringify(sample)).toBe(false);
      expect(validateWithJsonSchema(sample), JSON.stringify(sample)).toBe(false);
    }
  });

  it("never lets a record's fields set its prototype: the JSON Schema refuses __proto__, zod drops it", () => {
    const record = JSON.parse('{"__proto__": {"polluted": true}, "title": "x"}') as unknown;
    const sample = { operations: [{ op: "add", collection: "tasks", record }] };
    expect(validateWithJsonSchema(sample)).toBe(false);
    const parsed = patchBatchSchema.parse(sample).operations[0];
    expect(parsed).toEqual({ op: "add", collection: "tasks", record: { title: "x" } });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
