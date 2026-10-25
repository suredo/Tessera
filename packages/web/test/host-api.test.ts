import { describe, expect, it, vi } from "vitest";
import { ask, HostError, type Send } from "../src/host-api.ts";

// A stand-in translator that marks its text, so only words taken from the translation layer pass.
vi.mock("../src/i18n/translate.ts", () => ({ t: (key: string) => `[${key}]` }));

const answering =
  (body: string): Send =>
  () =>
    Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } }));

describe("UX-05: an answer the app can't read is reported through the translation layer", () => {
  it("when it isn't JSON", async () => {
    const error = await ask("workspaces.list", {}, answering("<html>")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostError);
    expect((error as Error).message).toBe("[app.unreadable]");
  });

  it("when its result breaks the contract (CON-01)", async () => {
    const reply = JSON.stringify({ ok: true, result: { workspaces: "not a list" } });
    const error = await ask("workspaces.list", {}, answering(reply)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostError);
    expect((error as Error).message).toBe("[app.unreadable]");
  });
});

it("passes on the server's own plain refusal", async () => {
  const reply = JSON.stringify({
    ok: false,
    error: { code: "refused", message: "That workspace is gone." },
  });
  await expect(ask("workspaces.list", {}, answering(reply))).rejects.toThrow(
    "That workspace is gone.",
  );
});
