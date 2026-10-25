import { describe, expect, it, vi } from "vitest";
import { exportArchive, importArchive } from "../src/archives.ts";
import type { Send } from "../src/host-api.ts";

// A stand-in translator that marks its text, so only words taken from the translation layer pass.
vi.mock("../src/i18n/translate.ts", () => ({ t: (key: string) => `[${key}]` }));

const answering =
  (response: Response): Send =>
  () =>
    Promise.resolve(response);
const request = { exported: "workspace", id: "00000000-0000-4000-8000-000000000000" } as const;

describe("APP-06: exporting", () => {
  it("names the file as the server did, in UTF-8 when it gave one", async () => {
    const file = "Café plan 2026-10-25.tessera";
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "content-disposition": `attachment; filename="Caf- plan 2026-10-25.tessera"; filename*=UTF-8''${encodeURIComponent(file)}`,
      },
    });
    const exported = await exportArchive(request, answering(response));
    expect(exported.name).toBe(file);
    expect(new Uint8Array(await exported.file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("passes on the server's plain refusal, and says a failure in the host's words", async () => {
    const refused = new Response("There is no workspace with that ID to export.", { status: 404 });
    await expect(exportArchive(request, answering(refused))).rejects.toThrow(
      "There is no workspace with that ID to export.",
    );
    const failed = new Response("TypeError: at line 3", { status: 500 });
    await expect(exportArchive(request, answering(failed))).rejects.toThrow(
      "[archive.exportFailed]",
    );
  });
});

describe("APP-06: importing", () => {
  it("gives back the server's report, checked against the contract", async () => {
    const reply = { ok: false, message: "That file isn't a Tessera archive." };
    const response = new Response(JSON.stringify(reply));
    await expect(importArchive(new Blob(["x"]), answering(response))).resolves.toEqual(reply);
  });

  it("says an answer it can't read in the host's words (UX-05)", async () => {
    const response = new Response(JSON.stringify({ ok: true }));
    await expect(importArchive(new Blob(["x"]), answering(response))).rejects.toThrow(
      "[app.unreadable]",
    );
  });
});
