import { describe, expect, it } from "vitest";
import { BRIDGE_ROUTE, type BridgeReply } from "@tessera/contracts";
import { BridgeError, serveBridge, serverData, type BridgeTool, type Send } from "../src/index.ts";

// The host page's data handlers (RUN-04, BRG-04): each data call goes to the server's bridge
// route with the workspace, the phase and the call as the tool made it, and the server's answer
// comes back as a result or as the bridge's refusal. A stand-in for the server answers here; the
// browser tests run the real route.

const WORKSPACE = "6f1c2a52-8f0e-4c55-9a43-9d8f2c1b7e10";
const call = { requestId: "p1a2b3c4d-c1", action: "data.read", args: {} };

/** A server that answers every request with `answer`, and keeps what it was sent. */
function server(answer: { status?: number; json: unknown }) {
  const sent: { url: string; init: RequestInit }[] = [];
  const send: Send = (url, init) => {
    sent.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(answer.json), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { send, sent };
}

describe("the host page's data handlers (RUN-04)", () => {
  it("sends the workspace, the phase and the tool's own call, and gives back the result", async () => {
    const result = { data: { tasks: [] }, revisions: {} };
    const { send, sent } = server({ json: { requestId: call.requestId, ok: true, result } });
    await expect(serverData(WORKSPACE, send).read({ phase: "starting", call })).resolves.toEqual(
      result,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(BRIDGE_ROUTE);
    expect(sent[0]!.init.method).toBe("POST");
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({
      workspaceId: WORKSPACE,
      phase: "starting",
      call,
    });
  });

  it("BRG-04: passes on the server's refusal with its code and words", async () => {
    const message =
      'Nothing was changed: an entry in "tasks" was changed or removed after this change was planned, and that newer edit is kept.';
    const { send } = server({
      json: { requestId: call.requestId, ok: false, error: { code: "stale", message } },
    });
    const patch = serverData(WORKSPACE, send).patch(
      { operations: [{ op: "remove", collection: "tasks", id: "t-1", revisionCount: 1 }] },
      { phase: "active", call },
    );
    await expect(patch).rejects.toBeInstanceOf(BridgeError);
    await expect(patch).rejects.toMatchObject({ code: "stale", message });
  });

  it("treats any answer that isn't a reply as the host's own failure, not the server's words", async () => {
    for (const answer of [
      { status: 400, json: "Send a workspace, a phase and the tool's call, as JSON." },
      { status: 500, json: { error: "SQLITE_BUSY at C:/Users/me/tessera.db" } },
      { json: { requestId: call.requestId, ok: true } },
    ]) {
      const read = serverData(WORKSPACE, server(answer).send).read({ phase: "active", call });
      await expect(read).rejects.toThrow();
      await expect(read).rejects.not.toBeInstanceOf(BridgeError);
    }
  });

  it("is what serveBridge passes the tool's own call to, with the phase it was checked in", async () => {
    let listen: ((call: unknown) => void) | undefined;
    let interact: (() => void) | undefined;
    const replies: BridgeReply[] = [];
    const tool: BridgeTool = {
      instanceId: "i-1",
      onCall: (l) => ((listen = l), () => true),
      reply: (r) => replies.push(r as BridgeReply),
      onInteraction: (l) => ((interact = l), () => true),
      onEvent: () => () => true,
    };
    const stale = { code: "stale", message: "Nothing was changed: the entry changed first." };
    const { send, sent } = server({ json: { requestId: "p1a2b3c4d-c2", ok: false, error: stale } });
    serveBridge(tool, { capabilities: [], data: serverData(WORKSPACE, send) });
    interact!();
    const patch = {
      requestId: "p1a2b3c4d-c2",
      action: "data.patch",
      args: { operations: [{ op: "remove", collection: "tasks", id: "t-1", revisionCount: 1 }] },
    };
    listen!(patch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({
      workspaceId: WORKSPACE,
      phase: "active",
      call: patch,
    });
    expect(replies).toEqual([{ requestId: "p1a2b3c4d-c2", ok: false, error: stale }]);
  });
});
