import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_ACTIONS,
  BRIDGE_REQUEST_LIMIT_BYTES,
  BRIDGE_SERVER_LIMIT_BYTES,
  bridgeManifest,
  checkBridgeCall,
  checkSaveFile,
  filePickRequestSchema,
  pickName,
  pickNameSchema,
  saveName,
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

describe("a file a tool offers to save (CAP-03, A81)", () => {
  const png = btoa(
    String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13),
  );
  const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 16));

  it("CAP-03: a saved file's name is its last part, with the kind's extension, replacing one it had", () => {
    expect(saveName("groceries.csv", "text/csv")).toBe("groceries.csv");
    expect(saveName("notes.html", "text/plain")).toBe("notes.txt");
    expect(saveName("photo.PNG", "image/jpeg")).toBe("photo.jpg");
    expect(saveName("../../evil.exe", "application/json")).toBe("evil.json");
    expect(saveName("Report v1.2", "text/plain")).toBe("Report v1.2.txt");
    expect(saveName("..", "text/csv")).toBe("file.csv");
    expect(saveName("picture", "image/png")).toBe("picture.png");
    expect(saveName("y".repeat(300), "image/webp")).toHaveLength(255);
  });

  it("A81: an image must start as the kind it says, and JSON must parse", () => {
    expect(checkSaveFile({ name: "a.png", type: "image/png", bytesBase64: png })).toMatchObject({
      ok: true,
      file: { name: "a.png", type: "image/png" },
    });
    expect(checkSaveFile({ name: "a.jpg", type: "image/jpeg", bytesBase64: jpeg }).ok).toBe(true);
    for (const [type, bytesBase64] of [
      ["image/jpeg", png],
      ["image/webp", png],
      ["image/png", btoa("<svg onload=alert(1)>")],
    ] as const) {
      const refused = checkSaveFile({ name: "a", type, bytesBase64 });
      expect(refused, type).toMatchObject({ ok: false });
      expect(refused.ok ? "" : refused.message).toMatch(/^Nothing was saved: the bytes aren't/);
    }
    expect(checkSaveFile({ name: "d", type: "application/json", text: '{"a":1}' }).ok).toBe(true);
    expect(checkSaveFile({ name: "d", type: "application/json", text: "{a:1}" })).toEqual({
      ok: false,
      message: "Nothing was saved: the text isn't JSON, as the file says.",
    });
    const csv = checkSaveFile({ name: "list", type: "text/csv", text: "a,b\n1,2\n" });
    expect(csv.ok && new TextDecoder().decode(csv.file.bytes)).toBe("a,b\n1,2\n");
  });

  it("CON-03, A81: only images as bytes and plain data as text, in zod and the manifest's JSON Schema alike", () => {
    const action = bridgeManifest().actions.find((a) => a.name === "file.save")!;
    const valid = new Ajv({ strict: false }).compile(action.args);
    const cases: [unknown, boolean][] = [
      [{ name: "a.png", type: "image/png", bytesBase64: png }, true],
      [{ name: "a.csv", type: "text/csv", text: "a,b" }, true],
      [{ name: "a.json", type: "application/json", text: "{}" }, true],
      // Nothing that runs or renders when opened, and no image as text or text as bytes.
      [{ name: "a.html", type: "text/html", text: "<p>" }, false],
      [{ name: "a.svg", type: "image/svg+xml", text: "<svg/>" }, false],
      [{ name: "a.png", type: "image/png", text: "x" }, false],
      [{ name: "a.csv", type: "text/csv", bytesBase64: png }, false],
      [{ name: "a.csv", type: "text/csv", text: "a", bytesBase64: png }, false],
      [{ name: "a.csv", type: "text/csv", text: "" }, false],
      [{ name: "", type: "text/csv", text: "a" }, false],
      [{ name: "a.csv", type: "text/csv", text: "a", path: "/tmp" }, false],
    ];
    for (const [args, expected] of cases) {
      const at = JSON.stringify(args);
      expect(BRIDGE_ACTIONS["file.save"].args.safeParse(args).success, at).toBe(expected);
      expect(valid(args), at).toBe(expected);
    }
  });

  it("A81, RUN-04: the bridge takes a file of 25 MB to save, but the server's route stays as small as what it answers", () => {
    const save = BRIDGE_ACTIONS["file.save"].maxArgsBytes;
    expect(BRIDGE_REQUEST_LIMIT_BYTES).toBeGreaterThan(save);
    expect(BRIDGE_SERVER_LIMIT_BYTES).toBeLessThan(1024 * 1024);
    expect(BRIDGE_ACTIONS["file.save"].hostOnly).toBe(true);
  });
});
