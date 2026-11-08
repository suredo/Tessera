import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { intentSchema, toJsonSchema } from "../src/index.ts";

// zod (used in the host) and the generated JSON Schema (handed to the CLI) must give the same
// verdict on every sample, or the model could be held to a different contract than the host. A
// default (draft-07) ajv, as Claude Code uses to check --json-schema.
const validateWithJsonSchema = new Ajv({ strict: true }).compile(toJsonSchema("intent"));

const base = {
  interfacePart: "a table of my guests",
  dataPart: null,
  behaviorChange: false,
  lookOnly: false,
  targetsCurrentTool: false,
  language: "en",
  features: [{ name: "guest list", request: "a table of my guests" }],
  profile: null,
  drawsCharts: false,
};
const withoutFeatures: Record<string, unknown> = { kind: "create", ...base };
delete withoutFeatures["features"];

const valid: Record<string, unknown> = {
  "a new tool": { kind: "create", ...base },
  "opening a saved tool": { ...base, kind: "open_saved", savedToolId: "tool-42", features: [] },
  "a style edit in Portuguese": {
    ...base,
    kind: "edit",
    interfacePart: "cores mais escuras",
    lookOnly: true,
    targetsCurrentTool: true,
    language: "pt-BR",
    features: [],
  },
  "a behavior statement": { ...base, kind: "edit", interfacePart: null, behaviorChange: true },
  "a tool that draws charts (CAP-04)": { kind: "create", ...base, drawsCharts: true },
  "a tool that fits a verification profile (VER-03)": {
    ...base,
    kind: "create",
    interfacePart: "a shopping list",
    profile: "item-list",
  },
};

const invalid: Record<string, unknown> = {
  "open_saved without a tool ID (CON-02)": { ...base, kind: "open_saved" },
  "a tool ID on another kind (CON-02)": { ...base, kind: "create", savedToolId: "tool-42" },
  "an unknown kind": { ...base, kind: "delete_everything" },
  "a missing field": withoutFeatures,
  "a field the contract doesn't have": { ...base, kind: "create", confidence: 0.9 },
  "a language that isn't a BCP 47 tag": { ...base, kind: "create", language: "English" },
  "null where a value is required": { ...base, kind: "create", language: null },
  "an empty feature name": { ...base, kind: "create", features: [{ name: "", request: "x" }] },
  "a profile that isn't in the registry (VER-03)": { ...base, kind: "create", profile: "chess" },
};

describe("intent contract", () => {
  it.each(Object.entries(valid))("zod and the JSON Schema both accept %s (CON-01)", (_, sample) => {
    expect(intentSchema.safeParse(sample).success).toBe(true);
    expect(validateWithJsonSchema(sample)).toBe(true);
  });

  it.each(Object.entries(invalid))(
    "zod and the JSON Schema both refuse %s (CON-01)",
    (_, sample) => {
      expect(intentSchema.safeParse(sample).success).toBe(false);
      expect(validateWithJsonSchema(sample)).toBe(false);
    },
  );
});

describe("recorded intents", () => {
  it("VER-03: an answer recorded before profiles existed reads as fitting none", () => {
    const recorded: Record<string, unknown> = { kind: "create", ...base };
    delete recorded["profile"];
    expect(intentSchema.parse(recorded).profile).toBeNull();
  });

  it("CAP-04: an answer recorded before charts existed reads as showing none", () => {
    const recorded: Record<string, unknown> = { kind: "create", ...base };
    delete recorded["drawsCharts"];
    expect(intentSchema.parse(recorded).drawsCharts).toBe(false);
  });
});
