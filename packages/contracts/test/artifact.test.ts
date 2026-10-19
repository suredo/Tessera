import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  artifactSchema,
  canonicalJson,
  readArtifact,
  toJsonSchema,
  type Artifact,
} from "../src/index.ts";

// zod (the host's check) and the generated JSON Schema must agree on every sample (CON-01).
const validateWithJsonSchema = new Ajv({ strict: true }).compile(toJsonSchema("artifact"));

export const sampleArtifact: Artifact = {
  contractVersion: 1,
  code: { html: "<ul id='items'></ul>", css: "ul { margin: 0; }", js: "console.log('hi');" },
  data: {
    schemaVersion: 1,
    schema: { type: "object", properties: { items: { type: "array" } } },
    defaults: { items: [], units: ["kg", "g"] },
  },
  capabilities: ["clock"],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

describe("artifact contract (CON-04, DATA-04)", () => {
  it("accepts a tool version in zod and in its JSON Schema alike", () => {
    expect(artifactSchema.safeParse(sampleArtifact).success).toBe(true);
    expect(validateWithJsonSchema(sampleArtifact)).toBe(true);
  });

  it("refuses the same broken versions in zod and in its JSON Schema (CON-01)", () => {
    const broken: unknown[] = [
      { ...sampleArtifact, code: { html: "", css: "" } },
      { ...sampleArtifact, ui: { standardVersion: 1, mode: "legacy" } },
      { ...sampleArtifact, extra: true },
      { ...sampleArtifact, contractVersion: 2 },
      { ...sampleArtifact, capabilities: ["Clock"] },
      { ...sampleArtifact, pins: [{ id: "crowd", version: 0 }] },
    ];
    for (const sample of broken) {
      expect(artifactSchema.safeParse(sample).success, JSON.stringify(sample)).toBe(false);
      expect(validateWithJsonSchema(sample), JSON.stringify(sample)).toBe(false);
    }
  });

  it("writes the same canonical JSON whatever the key order, so a version has one hash", () => {
    const reordered = {
      ui: { mode: "standard", standardVersion: 1 },
      pins: [],
      capabilities: ["clock"],
      data: {
        defaults: { units: ["kg", "g"], items: [] },
        schema: { properties: { items: { type: "array" } }, type: "object" },
        schemaVersion: 1,
      },
      code: { js: "console.log('hi');", css: "ul { margin: 0; }", html: "<ul id='items'></ul>" },
      contractVersion: 1,
    };
    expect(canonicalJson(reordered)).toBe(canonicalJson(sampleArtifact));
    expect(canonicalJson({ b: [2, 1], a: { d: null, c: "x" }, skipped: undefined })).toBe(
      '{"a":{"c":"x","d":null},"b":[2,1]}',
    );
  });
});

describe("reading a stored tool version (CON-04)", () => {
  it("reads a current version as it is", () => {
    expect(readArtifact(JSON.parse(JSON.stringify(sampleArtifact)))).toEqual({
      kind: "ok",
      artifact: sampleArtifact,
      upgradedFromVersion: null,
    });
  });

  it("marks a newer, unversioned or broken version incompatible, with the reason", () => {
    const reason = (stored: unknown) => {
      const reading = readArtifact(stored);
      return reading.kind === "incompatible" ? reading.reason : "compatible";
    };
    expect(reason({ ...sampleArtifact, contractVersion: 9 })).toMatch(/newer version of Tessera/);
    expect(reason({ code: {} })).toBe("It has no contract version.");
    expect(reason("<html>")).toBe("It isn't a tool version.");
    expect(reason({ ...sampleArtifact, code: { html: "" } })).toMatch(/at code/);
  });

  it("upgrades an older version step by step, or says it can't", () => {
    // A made-up contract 2 that renamed `ui` to `look`, to exercise the upgrade path.
    const v2 = artifactSchema
      .omit({ ui: true, contractVersion: true })
      .extend({ contractVersion: z.literal(2), look: artifactSchema.shape.ui });
    const upgrades = {
      1: ({ ui, ...rest }: Record<string, unknown>) => ({ ...rest, contractVersion: 2, look: ui }),
    };
    const reading = readArtifact(sampleArtifact, {
      current: 2,
      upgrades,
      schema: v2 as unknown as z.ZodType<Artifact>,
    });
    expect(reading).toMatchObject({ kind: "ok", upgradedFromVersion: 1 });
    expect(reading.kind === "ok" && "look" in reading.artifact).toBe(true);

    expect(readArtifact(sampleArtifact, { current: 2, upgrades: {} })).toEqual({
      kind: "incompatible",
      reason: "There is no way to upgrade it from contract 1.",
    });
  });
});
