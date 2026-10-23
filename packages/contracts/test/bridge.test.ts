import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_ACTIONS,
  BRIDGE_CAPABILITIES,
  BRIDGE_MAX_DEPTH,
  BRIDGE_REQUEST_LIMIT_BYTES,
  bridgeManifest,
  bridgeReplySchema,
  checkBridgeCall,
  numericFieldsWithoutUnit,
  toJsonSchema,
  type BridgeContext,
  type BridgeErrorCode,
} from "../src/index.ts";

// The bridge's checks (RUN-04, CON-03), one group per bridge boundary check in the threat model
// (docs/spec/threat-model.md). BRG-04, a stale batch, is the patch engine's (DATA-02) and is
// checked end to end once the bridge reaches the data (#46).

const ajv = new Ajv({ strict: false });
const active: BridgeContext = { instanceId: "i-1", phase: "active", capabilities: ["clock"] };
const call = (message: unknown, context: BridgeContext = active) =>
  checkBridgeCall(context.instanceId, message, context);
const req = (action: string, args: unknown = {}) => ({ requestId: "r-1", action, args });

/** The code a refused call is answered with, after checking the reply fits its contract. */
const refusal = (result: ReturnType<typeof call>): BridgeErrorCode | "accepted" | "no reply" => {
  if (result.ok) return "accepted";
  if (!result.reply) return "no reply";
  expect(bridgeReplySchema.safeParse(result.reply).success).toBe(true);
  expect(result.reply.error.message.length).toBeGreaterThan(10);
  return result.reply.error.code;
};

describe("the bridge manifest (CON-03, CAP-01)", () => {
  const manifest = bridgeManifest();

  it("lists every action with a description, its arguments, result, limit and examples", () => {
    expect(manifest.actions.map((a) => a.name).sort()).toEqual(Object.keys(BRIDGE_ACTIONS).sort());
    for (const action of manifest.actions) {
      expect(action.description.length, action.name).toBeGreaterThan(20);
      expect(action.maxArgsBytes, action.name).toBeLessThan(BRIDGE_REQUEST_LIMIT_BYTES);
      expect(action.examples.length, action.name).toBeGreaterThan(0);
    }
  });

  it("gives examples that fit their action, in zod and in the manifest's JSON Schema alike", () => {
    for (const action of manifest.actions) {
      const defined = BRIDGE_ACTIONS[action.name as keyof typeof BRIDGE_ACTIONS];
      const [validArgs, validResult] = [ajv.compile(action.args), ajv.compile(action.result)];
      for (const example of action.examples) {
        expect(defined.args.safeParse(example.args).success, action.name).toBe(true);
        expect(defined.result.safeParse(example.result).success, action.name).toBe(true);
        expect(validArgs(example.args), action.name).toBe(true);
        expect(validResult(example.result), action.name).toBe(true);
      }
    }
  });

  it("names only capabilities it describes, each with a plain description", () => {
    const named = manifest.actions.flatMap((a) => (a.capability ? [a.capability] : []));
    for (const capability of named) expect(Object.keys(BRIDGE_CAPABILITIES)).toContain(capability);
    for (const capability of manifest.capabilities) {
      expect(capability.description.length).toBeGreaterThan(20);
    }
  });

  it("names the unit of every number in its arguments and results (CON-05)", () => {
    for (const action of manifest.actions) {
      expect(numericFieldsWithoutUnit(action.args), action.name).toEqual([]);
      expect(numericFieldsWithoutUnit(action.result), action.name).toEqual([]);
    }
  });

  it("has no argument that could name a file, a URL or a workspace (BRG-07)", () => {
    const names: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== "object" || node === null) return;
      const properties = (node as { properties?: Record<string, unknown> }).properties ?? {};
      names.push(...Object.keys(properties));
      Object.values(node).forEach(walk);
    };
    manifest.actions.forEach((action) => walk(action.args));
    expect(names.filter((n) => /path|file|url|uri|href|workspace|folder|dir/i.test(n))).toEqual([]);
  });
});

describe("bridge requests and replies (CON-01)", () => {
  it("refuses the same requests and replies in zod and in their JSON Schema", () => {
    const validRequest = ajv.compile(toJsonSchema("bridgeRequest"));
    const validReply = ajv.compile(toJsonSchema("bridgeReply"));
    expect(validRequest(req("data.read"))).toBe(true);
    for (const broken of [
      { action: "data.read", args: {} },
      { ...req("data.read"), extra: 1 },
      { ...req("data.read"), requestId: "has spaces" },
      { ...req("data.read"), action: "" },
    ]) {
      expect(validRequest(broken), JSON.stringify(broken)).toBe(false);
    }
    const replies = [
      { requestId: "r-1", ok: true, result: { addedIds: [] } },
      { requestId: null, ok: false, error: { code: "malformed", message: "Not a call." } },
    ];
    for (const reply of replies) {
      expect(validReply(reply)).toBe(true);
      expect(bridgeReplySchema.safeParse(reply).success).toBe(true);
    }
    const brokenReplies = [
      { requestId: null, ok: true, result: {} },
      { requestId: "r-1", ok: true, result: 1 },
      { requestId: "r-1", ok: false, error: { code: "oops", message: "No." } },
      { requestId: "r-1", ok: true, result: 1, error: { code: "failed", message: "Both." } },
    ];
    for (const reply of brokenReplies) {
      expect(validReply(reply), JSON.stringify(reply)).toBe(false);
      expect(bridgeReplySchema.safeParse(reply).success, JSON.stringify(reply)).toBe(false);
    }
  });
});

describe("checking a call (RUN-04)", () => {
  it("accepts a well-formed call and hands back its parsed arguments", () => {
    const batch = BRIDGE_ACTIONS["data.patch"].examples[0].args;
    expect(call(req("data.patch", batch))).toEqual({
      ok: true,
      requestId: "r-1",
      action: "data.patch",
      args: batch,
    });
    expect(call(req("data.read"))).toMatchObject({ ok: true, action: "data.read" });
  });

  it("BRG-01: refuses malformed calls with a plain reply, and keeps the request ID when it can", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    const malformed: unknown[] = [
      undefined,
      null,
      "data.read",
      42,
      [],
      { action: "data.read", args: {} },
      { requestId: 7, action: "data.read", args: {} },
      { requestId: "r-1", action: "data.read" },
      req("data.read", "all"),
      req("data.read", []),
      req("data.read", null),
      { ...req("data.read"), extra: true },
      { ...req("data.read"), args: { when: new Date() } },
      { ...req("data.read"), args: new Map() },
      { ...req("data.read"), args: { n: Number.NaN } },
      { ...req("data.read"), args: { gone: undefined } },
      req("data.read", { f: () => 1 }),
      cycle,
      JSON.parse(`{"requestId":"r-1","action":"data.read","args":{},"__proto__":{"x":1}}`),
    ];
    for (const message of malformed) expect(refusal(call(message))).toBe("malformed");
    const withId = call({ ...req("data.read"), extra: true });
    expect(!withId.ok && withId.reply?.requestId).toBe("r-1");
    const withoutId = call({ requestId: "not ok!", action: "data.read" });
    expect(!withoutId.ok && withoutId.reply?.requestId).toBeNull();
  });

  it("BRG-01: refuses nesting past the limit without running out of stack", () => {
    let deep: unknown = {};
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(refusal(call(req("data.read", deep)))).toBe("malformed");
    // The call itself, its args, the operations, an operation and its record take five levels.
    const nested = (levels: number) => {
      let value: unknown = "x";
      for (let i = 0; i < levels; i++) value = [value];
      return { operations: [{ op: "add", collection: "c", record: { v: value } }] };
    };
    expect(refusal(call(req("data.patch", nested(BRIDGE_MAX_DEPTH - 5))))).toBe("accepted");
    expect(refusal(call(req("data.patch", nested(BRIDGE_MAX_DEPTH - 4))))).toBe("malformed");
  });

  it("BRG-01: refuses a call over the bridge's limit or its action's", () => {
    const huge = "x".repeat(BRIDGE_REQUEST_LIMIT_BYTES);
    expect(refusal(call(req("data.read", { huge })))).toBe("too-large");
    expect(refusal(call(req("data.read", { note: "x".repeat(2000) })))).toBe("too-large");
    // Measured as UTF-8: 600 two-byte characters are over a 1 KB limit.
    expect(refusal(call(req("clock.now", { note: "é".repeat(600) })))).toBe("too-large");
  });

  it("BRG-02: refuses an action the manifest doesn't list, whatever its name", () => {
    for (const action of ["data.delete", "fs.read", "toString", "constructor", "__proto__"]) {
      expect(refusal(call(req(action))), action).toBe("unknown-action");
    }
  });

  it("BRG-03: refuses a capability the tool didn't declare, and allows it once declared", () => {
    const undeclared = { ...active, capabilities: [] };
    expect(refusal(call(req("clock.now"), undeclared))).toBe("undeclared-capability");
    expect(refusal(call(req("clock.now")))).toBe("accepted");
    // Actions every tool has need no declaration.
    expect(refusal(call(req("data.read"), undeclared))).toBe("accepted");
  });

  it("BRG-05: ignores a call from another instance, without a reply", () => {
    for (const other of ["i-0", "", undefined, null, { instanceId: "i-1" }]) {
      expect(refusal(checkBridgeCall(other, req("data.read"), active))).toBe("no reply");
    }
  });

  it("BRG-06: refuses a write before the tool is active, saying why; reads still work", () => {
    const batch = BRIDGE_ACTIONS["data.patch"].examples[0].args;
    for (const phase of ["starting", "staging"] as const) {
      const result = call(req("data.patch", batch), { ...active, phase });
      expect(refusal(result), phase).toBe("not-active");
      expect(!result.ok && result.reply?.error.message).toMatch(/Nothing was saved/);
      expect(refusal(call(req("data.read"), { ...active, phase })), phase).toBe("accepted");
    }
  });

  it("BRG-07: refuses arguments that name a file, a URL or another workspace", () => {
    const refused: [string, unknown][] = [
      ["data.read", { workspaceId: "w-2" }],
      ["data.read", { path: "C:/Users/me/notes.json" }],
      ["clock.now", { url: "http://example.com/time" }],
      [
        "data.patch",
        { operations: [{ op: "remove", collection: "../w-2", id: "x", revisionCount: 1 }] },
      ],
      [
        "data.patch",
        { operations: [{ op: "remove", collection: "tasks", id: "../x", revisionCount: 1 }] },
      ],
      ["data.patch", { workspaceId: "w-2", operations: [] }],
    ];
    for (const [action, args] of refused) {
      expect(refusal(call(req(action, args))), JSON.stringify(args)).toBe("invalid-args");
    }
  });
});
