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
  contractVersion: 4,
  connections: {},
  code: { html: "<ul id='items'></ul>", css: "ul { margin: 0; }", js: "console.log('hi');" },
  data: {
    schemaVersion: 1,
    schema: { type: "object", properties: { items: { type: "array" } } },
    defaults: { items: [], units: ["kg", "g"] },
    migrations: [],
  },
  capabilities: ["clock"],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
};

// The sample as an earlier contract stored it, before tools named their connections.
const withoutConnections = (): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...sampleArtifact };
  delete copy["connections"];
  return copy;
};

describe("artifact contract (CON-04, DATA-04)", () => {
  it("accepts a tool version in zod and in its JSON Schema alike", () => {
    const uses = (count: number, samples = {}) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`c-${i}`, { samples }]));
    const tenSamples = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `/p${i}`,
        { statusCode: 200, contentType: null, body: "" },
      ]),
    );
    for (const sample of [
      sampleArtifact,
      { ...sampleArtifact, connections: uses(50) },
      { ...sampleArtifact, connections: uses(1, tenSamples) },
      {
        ...sampleArtifact,
        connections: uses(1, {
          "/s": { statusCode: 200, contentType: null, body: "é".repeat(16 * 1024) },
        }),
      },
    ]) {
      expect(artifactSchema.safeParse(sample).success).toBe(true);
      expect(validateWithJsonSchema(sample)).toBe(true);
    }
  });

  it("refuses the same broken versions in zod and in its JSON Schema (CON-01)", () => {
    const broken: unknown[] = [
      { ...sampleArtifact, code: { html: "", css: "" } },
      { ...sampleArtifact, ui: { standardVersion: 1, mode: "legacy" } },
      { ...sampleArtifact, extra: true },
      { ...sampleArtifact, contractVersion: 5 },
      { ...sampleArtifact, connections: ["movies"] },
      { ...sampleArtifact, connections: { Movies: { samples: {} } } },
      { ...sampleArtifact, connections: { movies: {} } },
      { ...sampleArtifact, connections: { movies: { samples: {}, extra: 1 } } },
      { ...sampleArtifact, connections: undefined },
      {
        ...sampleArtifact,
        connections: Object.fromEntries(
          Array.from({ length: 51 }, (_, i) => [`c-${i}`, { samples: {} }]),
        ),
      },
      // A sample's path is a path without a query, its answer a status, a type and a text.
      ...["search", "/search?q=1", "//elsewhere", "/a b"].map((p) => ({
        ...sampleArtifact,
        connections: {
          movies: { samples: { [p]: { statusCode: 200, contentType: null, body: "" } } },
        },
      })),
      {
        ...sampleArtifact,
        connections: {
          movies: { samples: { "/s": { statusCode: 99, contentType: null, body: "" } } },
        },
      },
      {
        ...sampleArtifact,
        connections: {
          movies: {
            samples: {
              "/s": { statusCode: 200, contentType: null, body: "x".repeat(16 * 1024 + 1) },
            },
          },
        },
      },
      // The limit is in characters, whatever their bytes, so both checks count it alike.
      {
        ...sampleArtifact,
        connections: {
          movies: {
            samples: {
              "/s": { statusCode: 200, contentType: null, body: "é".repeat(16 * 1024 + 1) },
            },
          },
        },
      },
      {
        ...sampleArtifact,
        connections: {
          movies: {
            samples: Object.fromEntries(
              Array.from({ length: 11 }, (_, i) => [
                `/p${i}`,
                { statusCode: 200, contentType: null, body: "" },
              ]),
            ),
          },
        },
      },
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
        migrations: [],
      },
      code: { js: "console.log('hi');", css: "ul { margin: 0; }", html: "<ul id='items'></ul>" },
      contractVersion: 4,
      connections: {},
    };
    expect(canonicalJson(reordered)).toBe(canonicalJson(sampleArtifact));
    expect(canonicalJson({ b: [2, 1], a: { d: null, c: "x" }, skipped: undefined })).toBe(
      '{"a":{"c":"x","d":null},"b":[2,1]}',
    );
  });
});

describe("a tool version's migrations (DATA-03, SEC-01)", () => {
  it("MIG-01, MIG-02: refuses code, unknown operations and anything out of bounds, in zod and its JSON Schema alike", () => {
    const broken = [
      [{ op: "evaluate", collection: "tasks", code: "record.done = true" }],
      [{ op: "renameField", collection: "tasks", from: "name", to: "title", js: "x => x" }],
      [{ op: "addField", collection: "tasks", fields: { done: { nested: true } } }],
      [{ op: "mapValues", collection: "tasks", field: "state", map: [["open", ["done"]]] }],
      [{ op: "removeField", collection: "../other", field: "title" }],
      [{ op: "removeField", collection: "tasks", field: "id" }],
      [{ op: "setType", collection: "tasks", field: "size", to: "boolean" }],
      Array.from({ length: 51 }, () => ({ op: "removeField", collection: "tasks", field: "x" })),
      [],
    ].map((operations) => ({
      ...sampleArtifact,
      data: {
        ...sampleArtifact.data,
        migrations: [{ fromVersion: 1, toVersion: 2, operations }],
      },
    }));
    for (const sample of broken) {
      expect(artifactSchema.safeParse(sample).success, JSON.stringify(sample)).toBe(false);
      expect(validateWithJsonSchema(sample), JSON.stringify(sample)).toBe(false);
    }
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

  it("upgrades a stored contract 1 version: it declared no migrations (DATA-03)", () => {
    const { schemaVersion, schema, defaults } = sampleArtifact.data;
    const rest = withoutConnections();
    const storedV1 = { ...rest, contractVersion: 1, data: { schemaVersion, schema, defaults } };
    expect(readArtifact(storedV1)).toEqual({
      kind: "ok",
      artifact: sampleArtifact,
      upgradedFromVersion: 1,
    });
  });

  it("CON-04: upgrades a stored contract 2 version: it used no connections (A66)", () => {
    const rest = withoutConnections();
    expect(readArtifact({ ...rest, contractVersion: 2 })).toEqual({
      kind: "ok",
      artifact: sampleArtifact,
      upgradedFromVersion: 2,
    });
    // An upgrade gives none, whatever the stored version held beside its contract.
    const reading = readArtifact({ ...rest, contractVersion: 2, connections: ["bank"] });
    expect(reading.kind === "ok" && reading.artifact.connections).toEqual({});
  });

  it("CON-04: upgrades a stored contract 3 version: each connection it named, with no samples (A69)", () => {
    const rest = withoutConnections();
    expect(readArtifact({ ...rest, contractVersion: 3, connections: ["movies", "bank"] })).toEqual({
      kind: "ok",
      artifact: {
        ...sampleArtifact,
        connections: { movies: { samples: {} }, bank: { samples: {} } },
      },
      upgradedFromVersion: 3,
    });
    // A list version 3 itself refused stays refused: never repaired into a map, never thrown on.
    for (const connections of [
      undefined,
      {},
      [null],
      ["movies", "movies"],
      Array.from({ length: 51 }, () => "movies"),
      [{ toString: "bad" }],
      ["Movies"],
    ]) {
      const reading = readArtifact({ ...rest, contractVersion: 3, connections });
      expect(reading.kind, JSON.stringify(connections)).toBe("incompatible");
    }
  });

  it("upgrades an older version step by step, or says it can't", () => {
    // A made-up contract 5 that renamed `ui` to `look`, to exercise the upgrade path.
    const v5 = artifactSchema
      .omit({ ui: true, contractVersion: true })
      .extend({ contractVersion: z.literal(5), look: artifactSchema.shape.ui });
    const upgrades = {
      4: ({ ui, ...rest }: Record<string, unknown>) => ({ ...rest, contractVersion: 5, look: ui }),
    };
    const reading = readArtifact(sampleArtifact, {
      current: 5,
      upgrades,
      schema: v5 as unknown as z.ZodType<Artifact>,
    });
    expect(reading).toMatchObject({ kind: "ok", upgradedFromVersion: 4 });
    expect(reading.kind === "ok" && "look" in reading.artifact).toBe(true);

    expect(readArtifact(sampleArtifact, { current: 5, upgrades: {} })).toEqual({
      kind: "incompatible",
      reason: "There is no way to upgrade it from contract 4.",
    });
  });
});
