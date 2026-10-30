import { describe, expect, it } from "vitest";
import { ACTIVATION_ROUTE, type ActivationReply } from "@tessera/contracts";
import { serverActivation, stubCheck, type CheckContext, type Send } from "../src/index.ts";

// Staging's parts that need no browser (RUN-03): the stub check, and activation through the
// server's route, answered here by a stand-in. The browser tests run the hidden panel itself
// against the real route.

const WORKSPACE = "6f1c2a52-8f0e-4c55-9a43-9d8f2c1b7e10";
const request = {
  workspaceId: WORKSPACE,
  hash: "a".repeat(64),
  expectedDataRevision: 3,
  token: WORKSPACE,
};
const workspace = {
  id: WORKSPACE,
  title: "Errands",
  currentVersion: "a".repeat(64),
  data: { tasks: [] },
  dataRevision: 4,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
};

/** A server that answers every request with `answer`, and keeps what it was sent. */
function server(answer: { status?: number; body: string }) {
  const sent: { url: string; init: RequestInit }[] = [];
  const send: Send = (url, init) => {
    sent.push({ url, init });
    return Promise.resolve(new Response(answer.body, { status: answer.status ?? 200 }));
  };
  return { send, sent };
}

describe("the stub check (RUN-03)", () => {
  it("is marked as a stub, and gives the outcome it was made with", async () => {
    const context = {} as CheckContext;
    expect(stubCheck()).toMatchObject({ name: "stub", stub: true });
    expect(await stubCheck().run(context)).toEqual({ ok: true });
    expect(await stubCheck({ ok: false, reason: "Not yet." }).run(context)).toEqual({
      ok: false,
      reason: "Not yet.",
    });
  });
});

describe("activation through the server (RUN-03, DATA-10)", () => {
  it("POSTs the workspace, the version and the planned revision to the route, and gives back its answer", async () => {
    const reply: ActivationReply = { ok: true, workspace, migrationCount: 1 };
    const { send, sent } = server({ body: JSON.stringify(reply) });
    expect(await serverActivation(send)(request)).toEqual(reply);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(ACTIVATION_ROUTE);
    expect(sent[0]!.init.method).toBe("POST");
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual(request);
  });

  it("MIG-06: gives back a refusal as an answer, not an error", async () => {
    const refused: ActivationReply = {
      ok: false,
      reason: "stale",
      message: "Nothing was changed: the data changed after this change was planned.",
    };
    const { send } = server({ body: JSON.stringify(refused) });
    expect(await serverActivation(send)(request)).toEqual(refused);
  });

  it("rejects with the route's plain words when it can't take the request, or with a plain error for a broken answer", async () => {
    const trashed = server({
      status: 404,
      body: "The workspace is in the trash; restore it first.",
    });
    await expect(serverActivation(trashed.send)(request)).rejects.toThrow(
      "The workspace is in the trash; restore it first.",
    );
    const silent = server({ status: 500, body: "" });
    await expect(serverActivation(silent.send)(request)).rejects.toThrow(
      "The activation route answered 500.",
    );
    const broken = server({ body: JSON.stringify({ ok: true }) });
    await expect(serverActivation(broken.send)(request)).rejects.toThrow(
      "The activation route's answer isn't a reply.",
    );
  });
});
