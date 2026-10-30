import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTES,
  editSchema,
  type Artifact,
  type Edit,
  type Intent,
} from "@tessera/contracts";
import {
  candidateFrom,
  editedCandidate,
  editTool,
  type EditInput,
} from "../src/generation/index.ts";
import { assemblePrompt, PROMPT_BUDGETS } from "../src/prompts/index.ts";
import { createScriptedProvider, type Provider, type StageSpec } from "../src/providers/index.ts";

type Answer = Extract<Edit, { outcome: "edit" }>;
const schema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: { id: { type: "string" }, title: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
const original = candidateFrom({
  outcome: "tool",
  name: "Shopping list",
  summary: "A list to use.",
  code: { html: '<h1>Shopping list</h1><ul id="items"></ul>', css: "body{color:#111}", js: "" },
  data: { schema, reusableDefaults: { items: [] }, initialState: {} },
  capabilities: [],
  uiMode: "standard",
});
if (original.kind !== "candidate") throw new Error("The fixture must be valid");
const artifact: Artifact = { ...original.artifact, pins: [{ id: "kept-pin", version: 1 }] };
const data = {
  items: [
    { id: "i-1", title: "PERSONAL MILK" },
    { id: "i-2", title: "Eggs" },
  ],
};
const intent: Intent = {
  kind: "edit",
  interfacePart: null,
  dataPart: null,
  targetsCurrentTool: true,
  behaviorChange: true,
  lookOnly: false,
  language: "en",
  features: [],
};
const input: EditInput = { request: "Add a quantity field", artifact, data, intent };
const unchanged: Answer = {
  outcome: "edit",
  summary: "No changes needed.",
  files: { mode: "unchanged" },
  data: { mode: "unchanged" },
};
const style: Answer = {
  ...unchanged,
  summary: "Made it darker.",
  files: { mode: "replace", code: { ...artifact.code, css: "body{color:#eee;background:#111}" } },
};
const quantitySchema = {
  ...schema,
  properties: {
    items: {
      ...schema.properties.items,
      items: {
        ...schema.properties.items.items,
        required: ["id", "title", "quantity"],
        properties: { ...schema.properties.items.items.properties, quantity: { type: "number" } },
      },
    },
  },
};
const quantity: Answer = {
  ...unchanged,
  summary: "Added a quantity to each item.",
  data: {
    mode: "migrate",
    schema: quantitySchema,
    defaults: { items: [] },
    migration: {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "addField", collection: "items", fields: { quantity: 1 } }],
    },
  },
};
function scripted(...replies: unknown[]) {
  const script = createScriptedProvider({ name: "edit", replies: replies as never });
  const calls: StageSpec<unknown>[] = [];
  const provider: Provider = {
    ...script,
    run: (spec) => {
      calls.push(spec);
      return script.run(spec);
    },
  };
  return { provider, calls };
}
const reply = (value: unknown, stage = "edit") => ({ kind: "value", stage, value });

describe("edit contracts and host validation (CON-02, GEN-07)", () => {
  it("CON-02, GEN-13: outputs declare independent file/data changes and cannot replace host-owned fields", () => {
    expect(editSchema.parse(quantity)).toEqual(quantity);
    for (const added of [
      { name: "Changed" },
      { capabilities: ["clock"] },
      { ui: { mode: "custom" } },
      { initialState: data },
    ]) {
      expect(editSchema.safeParse({ ...unchanged, ...added }).success).toBe(false);
    }
    expect(editSchema.safeParse({ ...unchanged, files: null }).success).toBe(false);
    expect(editSchema.safeParse({ ...unchanged, data: null }).success).toBe(false);
  });

  it("GEN-07: identical output is unchanged, including a replace that returns the same code", () => {
    expect(editedCandidate(input, unchanged)).toEqual({ kind: "unchanged" });
    expect(
      editedCandidate(input, { ...style, files: { mode: "replace", code: artifact.code } }),
    ).toEqual({ kind: "unchanged" });
  });

  it("GEN-07, GEN-13: an edit with unchanged files can migrate data, preserving every existing value on copies", () => {
    const snapshot = structuredClone(input);
    const result = editedCandidate(input, quantity);
    expect(result).toMatchObject({
      kind: "candidate",
      artifact: {
        code: artifact.code,
        capabilities: artifact.capabilities,
        pins: artifact.pins,
        ui: artifact.ui,
        data: {
          schemaVersion: 2,
          schema: quantitySchema,
          defaults: { items: [] },
          migrations: [quantity.data.mode === "migrate" && quantity.data.migration],
        },
      },
    });
    expect(input).toEqual(snapshot);
    // Existing entries stay with their workspace, never in a reusable artifact.
    expect(JSON.stringify(result)).not.toContain("PERSONAL MILK");
  });

  it("GEN-13: a style edit preserves code other than CSS, data, pins and declarations", () => {
    const look = { ...input, intent: { ...intent, lookOnly: true, behaviorChange: false } };
    expect(editedCandidate(look, style)).toMatchObject({
      kind: "candidate",
      artifact: { data: artifact.data, pins: artifact.pins, ui: artifact.ui },
    });
    const wrong = {
      ...style,
      files: { mode: "replace" as const, code: { ...artifact.code, html: "<h1>Different</h1>" } },
    };
    expect(editedCandidate(look, wrong)).toMatchObject({ kind: "failed", failure: "static" });
    expect(editedCandidate(look, quantity)).toMatchObject({
      kind: "failed",
      failure: "schema-shape",
    });
    expect(
      editedCandidate({ ...input, intent: { ...intent, behaviorChange: false } }, quantity),
    ).toMatchObject({ kind: "failed", failure: "schema-shape" });
  });

  it("DATA-03, GEN-13: invalid or lossy migrations and changed defaults are refused without changing entries", () => {
    if (quantity.data.mode !== "migrate") throw new Error("Expected migration fixture");
    const change = quantity.data;
    const cases: Answer[] = [
      {
        ...quantity,
        data: { ...change, migration: { ...change.migration, fromVersion: 2, toVersion: 3 } },
      },
      { ...quantity, data: { ...change, schema: { $ref: "#" } } },
      {
        ...quantity,
        data: { ...change, defaults: { items: [{ id: "fake", title: "Sample", quantity: 1 }] } },
      },
      {
        ...quantity,
        data: {
          ...change,
          migration: {
            ...change.migration,
            operations: [
              ...change.migration.operations,
              {
                op: "mapValues",
                collection: "items",
                field: "title",
                map: [["PERSONAL MILK", "Replaced"]],
              },
            ],
          },
        },
      },
      {
        ...quantity,
        data: {
          ...change,
          schema: {
            ...quantitySchema,
            properties: {
              items: {
                ...quantitySchema.properties.items,
                items: {
                  ...quantitySchema.properties.items.items,
                  required: ["id", "quantity"],
                  properties: { id: { type: "string" }, quantity: { type: "number" } },
                },
              },
            },
          },
          migration: {
            ...change.migration,
            operations: [
              ...change.migration.operations,
              { op: "removeField", collection: "items", field: "title" },
            ],
          },
        },
      },
    ];
    const snapshot = structuredClone(input);
    for (const attempt of cases)
      expect(editedCandidate(input, attempt)).toMatchObject({
        kind: "failed",
        failure: "schema-shape",
      });
    expect(input).toEqual(snapshot);
  });
});

describe("editing and repair (GEN-09)", () => {
  it("GEN-09, VER-01, CAP-01: edits check retained capabilities and repair hidden bridge access before staging", async () => {
    const clockEdit: Answer = {
      ...unchanged,
      files: { mode: "replace", code: { ...artifact.code, js: "tessera.call('clock.now');" } },
    };
    expect(editedCandidate(input, clockEdit)).toMatchObject({ kind: "failed", failure: "static" });
    expect(
      editedCandidate({ ...input, artifact: { ...artifact, capabilities: ["clock"] } }, clockEdit),
    ).toMatchObject({ kind: "candidate" });
    const borrowed: Answer = {
      ...unchanged,
      files: {
        mode: "replace",
        code: { ...artifact.code, js: "const call = tessera.call; call('unknown.action');" },
      },
    };
    const { provider, calls } = scripted(
      { kind: "value", stage: "edit", value: borrowed },
      { kind: "value", stage: "repair", value: style },
    );
    expect(await editTool(provider, DEFAULT_ROUTES, input)).toMatchObject({
      kind: "candidate",
      repairs: 1,
    });
    expect(calls.map((c) => c.stage)).toEqual(["edit", "repair"]);
    expect(calls[1]!.prompt).toContain("Don't borrow or compute bridge methods.");
  });

  it("RUN-07, GEN-09: editing repairs a system-clock read before staging", async () => {
    const unsafe: Answer = {
      ...unchanged,
      files: { mode: "replace", code: { ...artifact.code, js: "new Date();" } },
    };
    expect(editedCandidate(input, unsafe)).toMatchObject({ kind: "failed", failure: "static" });
    const { provider, calls } = scripted(
      { kind: "value", stage: "edit", value: unsafe },
      { kind: "value", stage: "repair", value: style },
    );
    expect(await editTool(provider, DEFAULT_ROUTES, input)).toMatchObject({
      kind: "candidate",
      repairs: 1,
    });
    expect(calls.map((c) => c.stage)).toEqual(["edit", "repair"]);
    expect(calls[1]!.prompt).toContain('tessera.call("clock.now")');
  });

  it("GEN-09, GEN-15: repairs wrong-shape and static failures once each, on repair route, retaining original source/language", async () => {
    const unsafe = {
      ...style,
      files: { mode: "replace", code: { ...artifact.code, html: '<iframe src="x"></iframe>' } },
    };
    const { provider, calls } = scripted(
      reply({ nope: true }),
      reply(unsafe, "repair"),
      reply(style, "repair"),
    );
    const usage = {};
    expect(
      await editTool(provider, DEFAULT_ROUTES, {
        ...input,
        intent: { ...intent, language: "pt-BR" },
        repairUsage: usage,
      }),
    ).toMatchObject({ kind: "candidate", repairs: 2 });
    expect(usage).toEqual({ "schema-shape": 1, static: 1 });
    expect(calls.map((c) => c.stage)).toEqual(["edit", "repair", "repair"]);
    for (const call of calls) {
      expect(call.timeLimitMs).toBe(180_000);
      expect(call.prompt).toContain("pt-BR");
      expect(call.prompt).not.toContain("PERSONAL MILK");
      expect(call.promptParts?.some((p) => p.startsWith("edit@"))).toBe(true);
      expect(call.promptParts?.some((p) => p.startsWith("create@"))).toBe(false);
    }
    expect(calls[2]!.prompt).toContain("iframe");
    expect(calls[2]!.model).toBe(DEFAULT_ROUTES.repair.model);
  });

  it("GEN-09: exhausted static budget stops a smoke repair failure without another call", async () => {
    const unsafe = {
      ...style,
      files: { mode: "replace", code: { ...artifact.code, html: '<iframe src="x"></iframe>' } },
    };
    const { provider, calls } = scripted(reply(unsafe, "repair"));
    const result = await editTool(provider, DEFAULT_ROUTES, {
      ...input,
      repairUsage: { static: 1 },
      repair: { failure: "smoke", diagnostics: ["The tool shows nothing."], attempt: style },
    });
    expect(result).toMatchObject({ kind: "failed", failure: "static", repairs: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.promptParts?.some((p) => p.startsWith("repair-edit-smoke@"))).toBe(true);
    expect(calls[0]!.promptParts?.some((p) => p.startsWith("repair-smoke@"))).toBe(false);
  });

  it("GEN-09: provider failures never repair, and cannot is an explicit answer", async () => {
    const { provider, calls } = scripted({ kind: "error", stage: "edit", error: "time_limit" });
    expect(await editTool(provider, DEFAULT_ROUTES, input)).toMatchObject({
      kind: "failed",
      failure: "provider",
    });
    expect(calls).toHaveLength(1);
    const cannot = scripted(
      reply({ outcome: "cannot", reason: "That would remove existing entries." }),
    );
    expect(await editTool(cannot.provider, DEFAULT_ROUTES, input)).toEqual({
      kind: "cannot",
      reason: "That would remove existing entries.",
    });
  });

  it("GEN-03: real edit and repair fixture prompts stay in their existing budgets", () => {
    const part = (name: string) =>
      fs.readFileSync(
        fileURLToPath(new URL(`./fixtures/prompts/shopping-list.${name}.txt`, import.meta.url)),
        "utf8",
      );
    const code = { html: part("html"), css: part("css"), js: part("js") };
    const original = { ...artifact, code };
    const prompt = {
      request: input.request,
      intent,
      uiMode: "standard" as const,
      source: code,
      editArtifact: original,
    };
    const edit = assemblePrompt({ ...prompt, stage: "edit" });
    expect(edit.parts.some((p) => p.startsWith("ui-edit@"))).toBe(true);
    expect(edit.parts.some((p) => p.startsWith("accessibility@"))).toBe(true);
    expect(edit.size, `edit size ${edit.size}`).toBeLessThanOrEqual(PROMPT_BUDGETS.edit);
    const repair = assemblePrompt({
      ...prompt,
      stage: "repair",
      failure: "static",
      diagnostics: ["HTML: a frame is not allowed."],
      editAttempt: { ...style, files: { mode: "replace", code } },
    });
    expect(repair.size, `repair size ${repair.size}`).toBeLessThanOrEqual(PROMPT_BUDGETS.repair);
  });
});
