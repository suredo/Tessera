import type { PatchBatch, PatchOperation } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import {
  applyPatch,
  createDataState,
  revisionOf,
  type DataState,
  type PatchResult,
  type ToolData,
} from "../src/patches/index.ts";

// IDs from a counter, so every run gives the same ones.
const counter = (prefix = "new") => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

const start = (): ToolData => ({
  title: "Groceries",
  units: ["kg", "g"],
  tasks: [
    { id: "a", title: "Milk", done: false },
    { id: "b", title: "Eggs", done: false },
    { id: "c", title: "Bread", done: true },
  ],
});

const applied = (result: PatchResult): DataState => {
  if (!result.ok) throw new Error(result.message);
  return result.state;
};
const replace = (state: DataState, id: string, field: string, value: string | boolean) => ({
  op: "replace" as const,
  collection: "tasks",
  id,
  revisionCount: revisionOf(state, "tasks", id)!,
  fields: { [field]: value },
});
const titles = (state: DataState) =>
  (state.data["tasks"] as { title: string }[]).map((t) => t.title);

describe("patch engine (DATA-02)", () => {
  it("applies a chat change planned before an in-tool edit to another record, and refuses one to the same record (DATA-02, BRG-04)", () => {
    const planned = createDataState(start());
    // The person edits "a" in the tool while a chat change is being prepared.
    const now = applied(
      applyPatch(planned, { operations: [replace(planned, "a", "title", "Oat milk")] }),
    );

    const other = applyPatch(now, { operations: [replace(planned, "b", "done", true)] });
    expect(other.ok).toBe(true);
    expect(applied(other).data["tasks"]).toEqual([
      { id: "a", title: "Oat milk", done: false },
      { id: "b", title: "Eggs", done: true },
      { id: "c", title: "Bread", done: true },
    ]);

    const same = applyPatch(now, {
      operations: [replace(planned, "b", "done", true), replace(planned, "a", "title", "Milk 2L")],
    });
    expect(same).toEqual({
      ok: false,
      reason: "stale",
      message:
        'Nothing was changed: an entry in "tasks" was changed or removed after this change was planned, and that newer edit is kept.',
      operationIndex: 1,
    });
  });

  it("resolves each operation after the ones before it, so a removal never retargets a later edit (DATA-02, L-23)", () => {
    const state = createDataState(start());
    const next = applied(
      applyPatch(state, {
        operations: [
          { op: "remove", collection: "tasks", id: "a", revisionCount: 1 },
          replace(state, "b", "title", "Brown eggs"),
        ],
      }),
    );
    expect(next.data["tasks"]).toEqual([
      { id: "b", title: "Brown eggs", done: false },
      { id: "c", title: "Bread", done: true },
    ]);
    expect(revisionOf(next, "tasks", "a")).toBeUndefined();
    expect(revisionOf(next, "tasks", "b")).toBe(2);
  });

  it("applies a batch whole or not at all, and never changes the state it was given (DATA-02, BRG-04)", () => {
    const state = createDataState(start());
    const before = structuredClone(state);
    const result = applyPatch(state, {
      operations: [
        { op: "add", collection: "tasks", record: { title: "Jam" } },
        replace(state, "a", "title", "Oat milk"),
        { ...replace(state, "b", "done", true), revisionCount: 7 },
      ],
    });
    expect(result).toMatchObject({ ok: false, reason: "stale", operationIndex: 2 });
    expect(state).toEqual(before);
  });

  it("gives added records their IDs, so adds never conflict with each other (DATA-02)", () => {
    const planned = createDataState(start());
    const add = (title: string): PatchBatch => ({
      operations: [{ op: "add", collection: "tasks", record: { title, done: false } }],
    });
    const newId = counter();
    const first = applyPatch(planned, add("Jam"), { newId });
    expect(first).toMatchObject({ ok: true, addedIds: ["new-1"] });
    const second = applyPatch(applied(first), add("Tea"), { newId });
    expect(second).toMatchObject({ ok: true, addedIds: ["new-2"] });
    expect(titles(applied(second))).toEqual(["Milk", "Eggs", "Bread", "Jam", "Tea"]);
    expect(revisionOf(applied(second), "tasks", "new-2")).toBe(1);
  });

  it("changes one field, never a whole record, and counts one revision per batch (DATA-02)", () => {
    const state = createDataState(start());
    const next = applied(
      applyPatch(state, {
        operations: [replace(state, "c", "title", "Rye"), replace(state, "c", "note", "sliced")],
      }),
    );
    expect(next.data["tasks"]).toContainEqual({
      id: "c",
      title: "Rye",
      done: true,
      note: "sliced",
    });
    expect(revisionOf(next, "tasks", "c")).toBe(2);
    expect(next.data["title"]).toBe("Groceries");

    const wholeRecord = applyPatch(state, {
      operations: [{ ...replace(state, "c", "id", "z") }],
    });
    expect(wholeRecord).toMatchObject({ ok: false, reason: "invalid", operationIndex: null });
  });

  it("refuses changes to lists that aren't there or aren't records, and edits after a removal in the same batch (DATA-02)", () => {
    const state = createDataState(start());
    const cases: [PatchOperation[], string][] = [
      [
        [{ op: "add", collection: "notes", record: { text: "x" } }],
        'Nothing was changed: the tool\'s data has no list called "notes".',
      ],
      [
        [{ op: "add", collection: "units", record: { name: "lb" } }],
        'Nothing was changed: the tool\'s data has no list called "units".',
      ],
      [
        [
          { op: "remove", collection: "tasks", id: "a", revisionCount: 1 },
          replace(state, "a", "done", true),
        ],
        'Nothing was changed: the change edits an entry in "tasks" that it removes earlier.',
      ],
    ];
    for (const [operations, message] of cases) {
      expect(applyPatch(state, { operations })).toMatchObject({
        ok: false,
        reason: "invalid",
        message,
      });
    }
  });

  it("refuses data over the limit with a plain message, but never a change that makes it smaller (DATA-06)", () => {
    const state = createDataState(start());
    const big = { op: "add" as const, collection: "tasks", record: { title: "x".repeat(300_000) } };
    expect(applyPatch(state, { operations: [big] })).toEqual({
      ok: false,
      reason: "too-large",
      message:
        "Nothing was changed: it would make the tool's data 294 KB, over its limit of 256 KB.",
      operationIndex: null,
    });

    // Data already over a lower limit can still shrink.
    const limitBytes = 100;
    const shrink = applyPatch(
      state,
      { operations: [{ op: "remove", collection: "tasks", id: "a", revisionCount: 1 }] },
      { limitBytes },
    );
    expect(shrink.ok).toBe(true);
    const grow = applyPatch(
      state,
      { operations: [replace(state, "a", "title", "Oat milk")] },
      {
        limitBytes,
      },
    );
    expect(grow).toMatchObject({ ok: false, reason: "too-large" });
  });

  it("refuses a batch with a __proto__ key anywhere, as the contract's JSON Schema does (DATA-02, CON-01)", () => {
    const state = createDataState(start());
    const batch = JSON.parse(
      '{"operations":[{"op":"add","collection":"tasks","record":{"title":"x","__proto__":{"done":true}}}]}',
    ) as unknown;
    expect(applyPatch(state, batch)).toMatchObject({ ok: false, reason: "invalid" });
    expect(titles(state)).toEqual(["Milk", "Eggs", "Bread"]);
  });

  it("refuses data whose list has two records with one ID (DATA-02)", () => {
    expect(() => createDataState({ tasks: [{ id: "a" }, { id: "a" }] })).toThrow(/two entries/);
  });
});

// The POC's 250-operation stress test, ported (M1 exit criterion). Two editors change the same
// data: the tool, planning against the current state, and chat, planning against an older
// snapshot. Every batch is checked against a plain model of records by ID: each one applies
// exactly as the model says, or is refused whole, with the reason the model expects.
describe("250-operation stress test (DATA-02, BRG-04, L-23)", () => {
  type Model = Map<string, Map<string, Record<string, unknown>>>;

  // A seeded generator (mulberry32), so a failure replays exactly.
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const toModel = (state: DataState): Model =>
    new Map(
      ["tasks", "notes"].map((c) => [
        c,
        new Map((state.data[c] as { id: string }[]).map((r) => [r.id, structuredClone(r)])),
      ]),
    );

  // What the model expects: the reason a batch is refused, or the data it leaves.
  function expected(state: DataState, batch: PatchBatch, addedIds: string[]) {
    const model = toModel(state);
    const ids = [...addedIds];
    for (const op of batch.operations) {
      const records = model.get(op.collection)!;
      if (op.op === "add") {
        const id = ids.shift()!;
        records.set(id, { id, ...op.record });
        continue;
      }
      if (revisionOf(state, op.collection, op.id) !== op.revisionCount) return "stale";
      const record = records.get(op.id);
      if (!record) return "invalid";
      if (op.op === "remove") records.delete(op.id);
      else records.set(op.id, { ...record, ...op.fields });
    }
    return {
      ...state.data,
      tasks: [...model.get("tasks")!.values()],
      notes: [...model.get("notes")!.values()],
    };
  }

  // A batch of one to six operations, planned against `plan`.
  function planBatch(plan: DataState, next: () => number): PatchBatch {
    const model = toModel(plan);
    const operations: PatchOperation[] = [];
    const removed: [string, string][] = [];
    const size = 1 + Math.floor(next() * 6);
    for (let i = 0; i < size; i++) {
      const collection = next() < 0.6 ? "tasks" : "notes";
      // Sometimes a record this batch already removed, which the engine must refuse.
      const live = [...model.get(collection)!.keys()];
      const gone = removed.filter(([c]) => c === collection).map(([, id]) => id);
      const pool = gone.length > 0 && next() < 0.3 ? gone : live;
      const roll = next();
      if (roll < 0.25 || pool.length === 0) {
        operations.push({
          op: "add",
          collection,
          record: { text: `t${i}`, n: Math.floor(next() * 100) },
        });
        continue;
      }
      const id = pool[Math.floor(next() * pool.length)]!;
      const revisionCount = revisionOf(plan, collection, id)!;
      if (roll < 0.8) {
        const field = next() < 0.5 ? "text" : "n";
        operations.push({
          op: "replace",
          collection,
          id,
          revisionCount,
          fields: { [field]: `v${i}` },
        });
      } else {
        operations.push({ op: "remove", collection, id, revisionCount });
        model.get(collection)!.delete(id);
        removed.push([collection, id]);
      }
    }
    return { operations };
  }

  it("agrees with the model over 250 operations, and every kind of outcome occurs", () => {
    const next = random(47);
    const newId = counter("r");
    const seed = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, text: `seed ${i}`, n: i }));
    let state = createDataState({ units: ["kg"], tasks: seed.slice(0, 4), notes: seed.slice(4) });
    let chatPlan = state;
    const outcomes = { applied: 0, stale: 0, invalid: 0 };
    let operations = 0;
    while (operations < 250) {
      const fromChat = next() < 0.3;
      const batch = planBatch(fromChat ? chatPlan : state, next);
      operations += batch.operations.length;
      const before = structuredClone(state);
      const result = applyPatch(state, batch, { newId });
      const want = expected(state, batch, result.ok ? result.addedIds : []);
      if (result.ok) {
        expect(result.state.data).toEqual(want);
        for (const c of ["tasks", "notes"]) {
          const ids = (result.state.data[c] as { id: string }[]).map((r) => r.id);
          expect(new Set(ids).size).toBe(ids.length);
          for (const id of ids) expect(revisionOf(result.state, c, id)).toBeGreaterThan(0);
        }
        expect(result.state.revisions.size).toBe(
          (result.state.data["tasks"] as unknown[]).length +
            (result.state.data["notes"] as unknown[]).length,
        );
        state = result.state;
        outcomes.applied++;
      } else {
        expect(result.reason).toBe(want);
        expect(result.message).toMatch(/^Nothing was changed: /);
        expect(state).toEqual(before);
        outcomes[result.reason as "stale" | "invalid"]++;
      }
      // Chat plans its next change once its reply is done, so tool edits in between make it stale.
      if (fromChat) chatPlan = state;
    }
    expect(operations).toBeGreaterThanOrEqual(250);
    expect(outcomes.applied).toBeGreaterThan(0);
    expect(outcomes.stale).toBeGreaterThan(0);
    expect(outcomes.invalid).toBeGreaterThan(0);
  });
});
