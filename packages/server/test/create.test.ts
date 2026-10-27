import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ROUTES, type Creation } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import { candidateFrom, createTool, startingDataOf } from "../src/generation/index.ts";
import { createScriptedProvider, type Provider, type StageSpec } from "../src/providers/index.ts";

// The create stage (GEN-04, GEN-05, GEN-09): the model's answer, a discriminated union (CON-02),
// becomes a candidate only after the host's checks, and every failure is classed for repair.
// Answers come from scripts; nothing reaches a model (ENG-11).

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "prompts");
const part = (name: string) =>
  fs.readFileSync(path.join(fixtures, `shopping-list.${name}.txt`), "utf8");

const listSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          quantity: { type: "number" },
          done: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    sections: { type: "array", items: { type: "object" } },
  },
  additionalProperties: false,
};

type Tool = Extract<Creation, { outcome: "tool" }>;
const tool = (overrides: Partial<Tool> = {}): Tool => ({
  outcome: "tool",
  name: "Shopping list",
  summary: "A list to tick off at the store.",
  code: { html: part("html"), css: part("css"), js: part("js") },
  data: {
    schema: listSchema,
    reusableDefaults: { items: [], sections: [{ id: "s-1", name: "Dairy" }] },
    initialState: {
      items: [
        { id: "i-1", title: "Milk", quantity: 2, done: false },
        { id: "i-2", title: "Eggs", quantity: 12, done: false },
      ],
    },
  },
  capabilities: [],
  uiMode: "standard",
  ...overrides,
});

/** A scripted provider giving these create answers, and every call it got. */
function answering(...replies: unknown[]) {
  const scripted = createScriptedProvider({ name: "create", replies: replies as never });
  const calls: StageSpec<unknown>[] = [];
  const provider: Provider = {
    ...scripted,
    run: (spec) => {
      calls.push(spec);
      return scripted.run(spec);
    },
  };
  return { provider, calls };
}

describe("starting data (GEN-05)", () => {
  it("GEN-05: the request's entries extend the defaults' lists, and never become defaults", () => {
    expect(
      startingDataOf(
        { items: [{ id: "d-1" }], title: "Mine", sections: [] },
        { items: [{ id: "i-1" }], title: "Ours" },
      ),
    ).toEqual({ items: [{ id: "d-1" }, { id: "i-1" }], title: "Ours", sections: [] });
    const result = candidateFrom(tool());
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    expect(result.artifact.data.defaults).toEqual({
      items: [],
      sections: [{ id: "s-1", name: "Dairy" }],
    });
    expect(result.startingData).toEqual({
      items: [
        { id: "i-1", title: "Milk", quantity: 2, done: false },
        { id: "i-2", title: "Eggs", quantity: 12, done: false },
      ],
      sections: [{ id: "s-1", name: "Dairy" }],
    });
  });
});

describe("the host's checks on a created tool (GEN-09, CON-04)", () => {
  it("CON-04: a good answer becomes an artifact of the current contract, with its name and summary", () => {
    const result = candidateFrom(tool({ capabilities: ["clock", "clock"] }));
    expect(result).toMatchObject({
      kind: "candidate",
      name: "Shopping list",
      summary: "A list to tick off at the store.",
      artifact: {
        contractVersion: 2,
        data: { schemaVersion: 1, schema: listSchema, migrations: [] },
        capabilities: ["clock"],
        pins: [],
        ui: { standardVersion: 1, mode: "standard" },
      },
    });
  });

  it("GEN-09, DATA-03: a data shape Tessera can't use is a schema-shape failure", () => {
    const result = candidateFrom(
      tool({
        data: {
          schema: { type: "object", properties: { items: { type: "string", pattern: "^a" } } },
          reusableDefaults: {},
          initialState: {},
        },
      }),
    );
    expect(result).toMatchObject({ kind: "failed", failure: "schema-shape" });
    expect(result.kind === "failed" && result.findings[0]).toMatch(/pattern/);
  });

  it("GEN-09, GEN-05: defaults or entries that don't fit the shape, or lack unique ids, are schema-shape failures", () => {
    const misfit = candidateFrom(
      tool({
        data: {
          schema: listSchema,
          reusableDefaults: { items: [] },
          initialState: { items: [{ id: "i-1", title: 3 }] },
        },
      }),
    );
    expect(misfit).toMatchObject({ kind: "failed", failure: "schema-shape" });
    expect(misfit.kind === "failed" && misfit.findings.join(" ")).toContain("The starting data:");

    const ids = candidateFrom(
      tool({
        data: {
          schema: { type: "object" },
          reusableDefaults: { tags: [{ name: "x" }] },
          initialState: { items: [{ id: "a" }, { id: "a" }] },
        },
      }),
    );
    expect(ids.kind === "failed" && ids.findings).toEqual([
      'The reusable defaults: record 1 in "tags" has no string id.',
      'The starting data: record 1 in "tags" has no string id.',
      'The starting data: the id "a" is used twice in "items".',
    ]);
  });

  it("GEN-09, VER-01: code the static check refuses is a static failure, saying where", () => {
    const result = candidateFrom(
      tool({
        code: { html: '<p>Hi</p>\n<iframe src="x"></iframe>', css: "", js: 'location.href = "x";' },
      }),
    );
    expect(result).toMatchObject({ kind: "failed", failure: "static" });
    expect(result.kind === "failed" && result.findings).toEqual([
      expect.stringMatching(/^HTML, line 2: The HTML has a <iframe> element/) as unknown,
      expect.stringMatching(/^JavaScript, line 1: /) as unknown,
      expect.stringMatching(/^JavaScript, line 1: /) as unknown,
    ]);
  });
});

describe("the create stage (GEN-04, CLI-09, GEN-11)", () => {
  it("GEN-04, CLI-09: asks once on the create route, with its prompt parts and the interface part as the request", async () => {
    const { provider, calls } = answering({ kind: "value", stage: "create", value: tool() });
    const result = await createTool(provider, DEFAULT_ROUTES, { request: "A shopping list" });
    expect(result.kind).toBe("candidate");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      stage: "create",
      model: DEFAULT_ROUTES.create.model,
      effort: DEFAULT_ROUTES.create.effort,
      tools: "none",
      timeLimitMs: 180_000,
    });
    expect(calls[0]!.prompt).toBe("The person's request:\n\nA shopping list");
    expect(calls[0]!.promptParts?.map((p) => p.split("@")[0])).toContain("create");
  });

  it("CON-02: an answer that no tool can do this is passed on, not a failure", async () => {
    const { provider } = answering({
      kind: "value",
      stage: "create",
      value: { outcome: "cannot", reason: "Booking a table needs the internet." },
    });
    expect(await createTool(provider, DEFAULT_ROUTES, { request: "Book a table" })).toEqual({
      kind: "cannot",
      reason: "Booking a table needs the internet.",
    });
  });

  it("GEN-09: an answer of the wrong shape can be repaired; any other provider failure can't", async () => {
    const wrongShape = answering({ kind: "value", stage: "create", value: { outcome: "tool" } });
    expect(await createTool(wrongShape.provider, DEFAULT_ROUTES, { request: "x" })).toMatchObject({
      kind: "failed",
      failure: "schema-shape",
    });
    for (const error of ["usage_limit", "sign_in", "time_limit", "cancelled"] as const) {
      const failing = answering({ kind: "error", stage: "create", error });
      const result = await createTool(failing.provider, DEFAULT_ROUTES, { request: "x" });
      expect(result, error).toMatchObject({ kind: "failed", failure: "provider" });
      expect(result.kind === "failed" && result.error?.kind).toBe(error);
    }
  });
});
