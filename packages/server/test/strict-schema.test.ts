import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  creationSchema,
  dataPlanSchema,
  editSchema,
  intentSchema,
  jsonSchemaOf,
} from "@tessera/contracts";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { restoreAnswer, toStrictSchema, wrapSchema } from "../src/providers/index.ts";

// The Codex adapter's projection of the contracts onto strict structured output (CLI-01, #266):
// every stage's schema must keep to strict mode's rules, and every real answer must come back
// exactly as the contract has it after travelling through the projected shape.

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const CONTRACTS: Record<string, z.ZodType> = {
  intent: intentSchema,
  create: creationSchema,
  edit: editSchema,
  data: dataPlanSchema,
};

/** The keywords strict structured output takes, as OpenAI documents them, minus the risky ones. */
const ALLOWED = new Set([
  "$schema",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "enum",
  "description",
  "$ref",
  "definitions",
  "$defs",
]);

/** Where a projected schema breaks strict mode's rules; empty when it keeps them. */
function strictProblems(node: unknown, at = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((item, i) => strictProblems(item, `${at}[${i}]`));
  if (!isNode(node)) return [];
  const problems: string[] = [];
  for (const key of Object.keys(node)) {
    if (!ALLOWED.has(key)) problems.push(`${at}: ${key}`);
  }
  if (node.type === "object") {
    if (!isNode(node.properties)) problems.push(`${at}: an object without properties`);
    else {
      if (node.additionalProperties !== false) problems.push(`${at}: an open object`);
      const keys = Object.keys(node.properties).sort();
      const required = Array.isArray(node.required) ? [...(node.required as string[])].sort() : [];
      if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${at}: optional keys`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "definitions" || key === "$defs") {
      for (const [name, child] of Object.entries(value as Node)) {
        problems.push(...strictProblems(child, `${at}.${key}.${name}`));
      }
    } else if (key === "items" || key === "anyOf") {
      problems.push(...strictProblems(value, `${at}.${key}`));
    }
  }
  return problems;
}

const ajv = new Ajv({ strict: false });

/**
 * A contract value written as a model keeping to the projected schema would write it: open maps
 * as JSON text, and every optional property present, null when absent. The test's own inverse of
 * `restoreAnswer`, guided by the original schema.
 */
function encode(value: unknown, node: unknown, root: Node): unknown {
  if (!isNode(node)) return value;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop()!;
    return encode(value, (root.definitions as Node)[name], root);
  }
  if (Array.isArray(node.allOf)) return encode(value, node.allOf[0], root);
  if (
    node.type === "object" &&
    node.properties === undefined &&
    node.additionalProperties !== false
  ) {
    return JSON.stringify(value);
  }
  const branches = (node.oneOf ?? node.anyOf) as Node[] | undefined;
  if (branches) {
    const branch = branches.find((b) =>
      ajv.validate({ ...b, definitions: root.definitions, $schema: undefined }, value),
    );
    return encode(value, branch, root);
  }
  if (isNode(node.properties) && isNode(value)) {
    const out: Node = {};
    for (const [key, property] of Object.entries(node.properties)) {
      out[key] = key in value ? encode(value[key], property, root) : null;
    }
    return out;
  }
  if (Array.isArray(value) && node.items !== undefined) {
    return value.map((item, i) =>
      encode(item, Array.isArray(node.items) ? (node.items as unknown[])[i] : node.items, root),
    );
  }
  return value;
}

/** Every answer in the rehearsals, by stage: hand-written answers shaped as the contracts say. */
function rehearsedAnswers(): { stage: string; value: unknown; from: string }[] {
  const folder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "evals",
    "scenarios",
    "rehearsals",
  );
  return fs.readdirSync(folder).flatMap((file) => {
    const { answers } = JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")) as {
      answers: { reply?: { kind?: string; stage?: string; value?: unknown } }[];
    };
    return answers
      .map((answer) => answer.reply)
      .filter((reply) => reply?.kind === "value" && reply.stage !== undefined)
      .map((reply) => ({ stage: reply!.stage!, value: reply!.value, from: file }));
  });
}

describe("strict structured output for Codex (CLI-01, #266)", () => {
  for (const [stage, contract] of Object.entries(CONTRACTS)) {
    it(`CLI-01: the ${stage} contract's projected schema keeps strict mode's rules`, () => {
      const strict = toStrictSchema(wrapSchema(jsonSchemaOf(contract)));
      expect(strictProblems(strict)).toEqual([]);
      expect(strict.type).toBe("object");
      // Still a usable schema.
      expect(() => ajv.compile({ ...strict, $schema: undefined })).not.toThrow();
    });
  }

  it("CLI-01: every rehearsed answer travels through the projected shape and comes back exactly", () => {
    const answers = rehearsedAnswers().filter(({ stage }) => stage in CONTRACTS);
    expect(answers.length).toBeGreaterThan(10);
    const stages = new Set<string>();
    for (const { stage, value, from } of answers) {
      const contract = CONTRACTS[stage]!;
      if (!contract.safeParse(value).success) continue;
      stages.add(stage);
      const wrapped = wrapSchema(jsonSchemaOf(contract));
      const strict = toStrictSchema(wrapped);
      const written = encode({ answer: value }, wrapped, wrapped);
      // What the model writes fits the projected schema...
      expect(ajv.validate({ ...strict, $schema: undefined }, written), `${from} ${stage}`).toBe(
        true,
      );
      // ...and turned back it is the contract's own value again.
      expect(restoreAnswer(written, wrapped), `${from} ${stage}`).toEqual({ answer: value });
    }
    expect([...stages].sort()).toEqual(["create", "data", "edit", "intent"]);
  });

  it("CLI-01: a key the contract refuses, such as __proto__, reaches the host's check as it came", () => {
    const wrapped = wrapSchema(jsonSchemaOf(dataPlanSchema));
    const written = JSON.parse(
      '{"answer":{"outcome":"patch","summary":"Remove the entry.","patch":{"operations":[{"op":"remove","collection":"tasks","id":"a","revisionCount":1}],"__proto__":{}}}}',
    ) as { answer: unknown };
    expect(dataPlanSchema.safeParse(written.answer).success).toBe(false);
    const restored = restoreAnswer(written, wrapped) as { answer: { patch: object } };
    expect(Object.hasOwn(restored.answer.patch, "__proto__")).toBe(true);
    expect(dataPlanSchema.safeParse(restored.answer).success).toBe(false);
  });

  it("CLI-01: an answer that breaks a rule the projection dropped is still turned back whole, so only that field is refused", () => {
    const valid = rehearsedAnswers().find(
      ({ stage, value }) => stage === "create" && creationSchema.safeParse(value).success,
    )!.value as Record<string, unknown>;
    const wrapped = wrapSchema(jsonSchemaOf(creationSchema));
    // Written as Codex writes a valid answer, then broken where the projection can't see it.
    const written = encode({ answer: valid }, wrapped, wrapped) as {
      answer: { name: string; leftOut: unknown; data: Record<string, unknown> };
    };
    written.answer.name = "";
    expect(written.answer.leftOut).toBeNull();
    expect(typeof written.answer.data.schema).toBe("string");
    const restored = restoreAnswer(written, wrapped) as { answer: unknown };
    expect(restored).toEqual({ answer: { ...valid, name: "" } });
    const issues = creationSchema.safeParse(restored.answer).error?.issues ?? [];
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["name"]);
  });

  it("CLI-01: an optional property absent, an open map and a union branch come back as the contract has them", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        answer: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { const: "a" },
                note: { type: "string", minLength: 1 },
                data: { type: "object", additionalProperties: { type: "number" } },
              },
              required: ["kind", "data"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: { kind: { const: "b" }, maybe: { type: ["string", "null"] } },
              required: ["kind"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["answer"],
      additionalProperties: false,
    };
    const strict = toStrictSchema(schema);
    expect(strictProblems(strict)).toEqual([]);
    expect(restoreAnswer({ answer: { kind: "a", note: null, data: '{"x":1}' } }, schema)).toEqual({
      answer: { kind: "a", data: { x: 1 } },
    });
    // A null the contract itself allows stays.
    expect(restoreAnswer({ answer: { kind: "b", maybe: null } }, schema)).toEqual({
      answer: { kind: "b", maybe: null },
    });
    // Text that isn't JSON stays as it came, for the host's check to refuse.
    expect(restoreAnswer({ answer: { kind: "a", note: "n", data: "{oops" } }, schema)).toEqual({
      answer: { kind: "a", note: "n", data: "{oops" },
    });
  });
});
