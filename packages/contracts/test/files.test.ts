import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_ACTIONS,
  bridgeManifest,
  checkBridgeCall,
  filePickRequestSchema,
  pickName,
  pickNameSchema,
} from "../src/index.ts";

// Files in (CAP-03, A80): what a picked file carries, and the file.pick call. A tool gets an
// asset's ID and what it is, never a path.

const NAMES = {
  good: ["beach.png", "Férias 2026.jpg", ".hidden.webp", "...a"],
  bad: ["", "../secret.png", "C:\\Users\\me\\photo.jpg", "a\nb.png", ".", "..", "x".repeat(256)],
};

describe("a picked file (CAP-03, A80)", () => {
  it("CAP-03: a picked file's name is never a path, nor only dots", () => {
    for (const name of NAMES.good) expect(pickNameSchema.safeParse(name).success, name).toBe(true);
    for (const name of NAMES.bad) expect(pickNameSchema.safeParse(name).success, name).toBe(false);
  });

  it("CON-03: the manifest's JSON Schema takes and refuses the same names as zod (#376 review)", () => {
    const action = bridgeManifest().actions.find((a) => a.name === "file.pick")!;
    const valid = new Ajv({ strict: false }).compile(action.result);
    const file = (name: string) => ({
      file: {
        id: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        type: "image/png",
        name,
        sizeBytes: 10,
        widthPx: 4,
        heightPx: 3,
      },
    });
    for (const name of [...NAMES.good, ...NAMES.bad]) {
      const zod = BRIDGE_ACTIONS["file.pick"].result.safeParse(file(name)).success;
      expect(valid(file(name)), name).toBe(zod);
    }
  });

  it("CAP-03: the host makes a name the browser gave one a pick may carry", () => {
    expect(pickName("C:\\fakepath\\beach.png")).toBe("beach.png");
    expect(pickName("photos/beach.png")).toBe("beach.png");
    expect(pickName(" tab\there.png ")).toBe("tabhere.png");
    expect(pickName("..")).toBe("picture");
    expect(pickName("")).toBe("picture");
    expect(pickName("y".repeat(300))).toHaveLength(255);
  });

  it("CAP-01, RUN-04: file.pick needs the files capability and takes no arguments", () => {
    const context = { instanceId: "i", phase: "active" as const, capabilities: ["files"] };
    const call = (args: unknown, capabilities = context.capabilities) =>
      checkBridgeCall(
        "i",
        { requestId: "r1", action: "file.pick", args },
        { ...context, capabilities },
      );
    expect(call({})).toMatchObject({ ok: true, action: "file.pick" });
    expect(call({ path: "/etc/passwd" })).toMatchObject({
      ok: false,
      reply: { error: { code: "invalid-args" } },
    });
    expect(call({}, [])).toMatchObject({
      ok: false,
      reply: { error: { code: "undeclared-capability" } },
    });
  });

  it("CAP-03: its answer is an image's asset ID and what it is, or null, never a path", () => {
    const result = BRIDGE_ACTIONS["file.pick"].result;
    expect(result.safeParse({ file: null }).success).toBe(true);
    const file = {
      id: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      type: "image/png",
      name: "beach.png",
      sizeBytes: 10,
      widthPx: 4,
      heightPx: 3,
    };
    expect(result.safeParse({ file }).success).toBe(true);
    expect(result.safeParse({ file: { ...file, path: "C:\\beach.png" } }).success).toBe(false);
    expect(result.safeParse({ file: { ...file, type: "image/svg+xml" } }).success).toBe(false);
  });

  it("RUN-04: what the host page sends with the bytes names the workspace, the phase, the call and the name", () => {
    const request = {
      workspaceId: "0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4",
      phase: "active",
      call: { requestId: "r1", action: "file.pick", args: {} },
      name: "beach.png",
    };
    expect(filePickRequestSchema.safeParse(request).success).toBe(true);
    expect(filePickRequestSchema.safeParse({ ...request, path: "/tmp" }).success).toBe(false);
    expect(filePickRequestSchema.safeParse({ ...request, name: "../x.png" }).success).toBe(false);
  });
});
