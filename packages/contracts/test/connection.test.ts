import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { connectionInputSchema, jsonSchemaOf } from "../src/index.ts";

// A connection's rules hold in zod and in its JSON Schema alike (CON-01), where a JSON Schema can
// say them: that a URL is an origin alone is zod's to check.
const validate = new Ajv({ strict: true, validateFormats: false }).compile(
  jsonSchemaOf(connectionInputSchema),
);

const input = {
  name: "movies",
  origins: ["https://api.example.com"],
  auth: { kind: "header", name: "Authorization", prefix: "Bearer " },
  key: "secret",
};

describe("a connection's contract (CON-01)", () => {
  it("CON-01: accepts a connection, and refuses an address listed twice, in zod and its JSON Schema alike", () => {
    expect(connectionInputSchema.safeParse(input).success).toBe(true);
    expect(validate(input)).toBe(true);
    const twice = { ...input, origins: ["https://api.example.com", "https://api.example.com"] };
    expect(connectionInputSchema.safeParse(twice).success).toBe(false);
    expect(validate(twice)).toBe(false);
  });
});
