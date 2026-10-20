import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  artifactSchema,
  jsonValueSchema,
  patchBatchSchema,
  refusingReservedKey,
  toJsonSchema,
  workspaceSchema,
  type Artifact,
} from "../src/index.ts";

// Stored JSON is kept exactly or refused whole, in zod and in the JSON Schema alike (CON-01).
// Formats (uuid, date-time) are zod's to check; this is about keys.
const validateWorkspace = new Ajv({ strict: true, validateFormats: false }).compile(
  toJsonSchema("workspace"),
);
const validateArtifact = new Ajv({ strict: true }).compile(toJsonSchema("artifact"));

const sampleArtifact: Artifact = {
  contractVersion: 1,
  code: { html: "<ul></ul>", css: "", js: "" },
  data: { schemaVersion: 1, schema: { type: "object" }, defaults: {} },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

const workspace = (data: unknown) => ({
  id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  title: "Plans",
  currentVersion: null,
  data,
  dataRevision: 0,
  createdAt: "2026-10-19T09:00:00.000Z",
  updatedAt: "2026-10-19T09:00:00.000Z",
});

// JSON.parse keeps "__proto__" as an own key, as data from a tool or an archive would have it.
const reserved = [
  '{"__proto__":{"notes":"keep me"},"other":1}',
  '{"a":{"b":[{"__proto__":1}]}}',
  '{"list":[[{"x":{"__proto__":null}}]]}',
];

describe("stored JSON (CON-01, DATA-08)", () => {
  it("CON-01: refuses a __proto__ key at any depth, in zod and in the JSON Schema alike", () => {
    for (const text of reserved) {
      const data: unknown = JSON.parse(text);
      expect(workspaceSchema.safeParse(workspace(data)).success, text).toBe(false);
      expect(validateWorkspace(workspace(data)), text).toBe(false);
      expect(jsonValueSchema.safeParse(data).success, text).toBe(false);
      const artifact = {
        ...sampleArtifact,
        data: { ...sampleArtifact.data, defaults: data },
      };
      expect(artifactSchema.safeParse(artifact).success, text).toBe(false);
      expect(validateArtifact(artifact), text).toBe(false);
    }
  });

  it("DATA-08: keeps every other key exactly, including ones objects already have", () => {
    const data: unknown = JSON.parse(
      '{"constructor":{"prototype":1},"toString":"x","hasOwnProperty":[true,null],"__proto":2,"a":{"b":[1.5,"",{}]}}',
    );
    const parsed = workspaceSchema.parse(workspace(data));
    expect(JSON.stringify(parsed.data)).toBe(JSON.stringify(data));
    expect(validateWorkspace(workspace(data))).toBe(true);
  });

  it("CON-01: is one rule, which any contract can wrap itself in, the patch batch among them", () => {
    // The batch's own keys are checked as well as its values, wherever the key hides.
    const strict = refusingReservedKey(z.strictObject({ a: z.number() }));
    expect(strict.safeParse(JSON.parse('{"a":1}')).success).toBe(true);
    expect(strict.safeParse(JSON.parse('{"a":1,"__proto__":{}}')).success).toBe(false);
    expect(strict.safeParse(JSON.parse('[{"a":{"__proto__":1}}]')).success).toBe(false);
    const add = (record: string) =>
      JSON.parse(
        `{"operations":[{"op":"add","collection":"tasks","record":${record}}]}`,
      ) as unknown;
    expect(patchBatchSchema.safeParse(add('{"title":"x"}')).success).toBe(true);
    expect(patchBatchSchema.safeParse(add('{"meta":{"__proto__":1}}')).success).toBe(false);
  });
});
