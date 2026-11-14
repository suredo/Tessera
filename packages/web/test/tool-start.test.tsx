import { BridgeError, type MountedTool, type ToolRuntime } from "@tessera/runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { startTool, withPermission, type StartDeps } from "../src/tool-start.ts";
import { WriteQuestion } from "../src/WriteQuestion.tsx";

// A host that answers `workspaces.open` only when the test says so, and a runtime that records
// what it was asked to do.
function setup() {
  let answer!: () => void;
  const deps = {
    ask: vi.fn(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ workspace: {}, capabilities: [] });
        }),
    ),
    serveBridge: vi.fn(),
    serverData: vi.fn(() => ({})),
  } as unknown as StartDeps;
  const open = vi.fn(() => Promise.resolve({} as MountedTool));
  return { deps, open, answer: () => answer() };
}
const runtime = {} as ToolRuntime;

describe("RUN-02: a panel closed while the server answers never starts its tool", () => {
  it("starts and serves the tool when nothing was cancelled", async () => {
    const { deps, open, answer } = setup();
    const started = startTool(runtime, "w1", open, new AbortController().signal, {}, deps);
    answer();
    await expect(started).resolves.toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(deps.serveBridge).toHaveBeenCalledOnce();
  });

  it("opens nothing once aborted before the answer", async () => {
    const { deps, open, answer } = setup();
    const controller = new AbortController();
    const started = startTool(runtime, "w1", open, controller.signal, {}, deps);
    controller.abort();
    answer();
    await expect(started).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(deps.serveBridge).not.toHaveBeenCalled();
  });

  it("serves no bridge once aborted while the tool was opening", async () => {
    const { deps, answer } = setup();
    const controller = new AbortController();
    const open = vi.fn(() => {
      controller.abort();
      return Promise.resolve({} as MountedTool);
    });
    const started = startTool(runtime, "w1", open, controller.signal, {}, deps);
    answer();
    await expect(started).resolves.toBe(false);
    expect(deps.serveBridge).not.toHaveBeenCalled();
  });
});

describe("APP-05: the panel hears about each change the tool saves", () => {
  // Starts a tool whose saved-data handlers succeed or refuse as `patch` says.
  async function started(patch: () => Promise<unknown>) {
    const { deps, open, answer } = setup();
    (deps.serverData as ReturnType<typeof vi.fn>).mockReturnValue({ read: vi.fn(), patch });
    const onWrite = vi.fn();
    const running = startTool(runtime, "w1", open, new AbortController().signal, { onWrite }, deps);
    answer();
    await running;
    const served = (deps.serveBridge as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      data: { patch: (batch: unknown, context: unknown) => Promise<unknown> };
    };
    return { onWrite, patch: () => served.data.patch({}, {}) };
  }

  it("after a change is saved", async () => {
    const { onWrite, patch } = await started(() => Promise.resolve({ ok: true }));
    expect(onWrite).not.toHaveBeenCalled();
    await expect(patch()).resolves.toEqual({ ok: true });
    expect(onWrite).toHaveBeenCalledOnce();
  });

  it("never for a change the server refused", async () => {
    const { onWrite, patch } = await started(() => Promise.reject(new Error("stale")));
    await expect(patch()).rejects.toThrow("stale");
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe("CNX-07: a tool's first change through a connection asks the person (A70)", () => {
  const post = {
    connection: "movies",
    method: "POST" as const,
    path: "/lists/1/items",
    body: '{"title":"Alien"}',
  };
  const answer = {
    statusCode: 201,
    contentType: "application/json",
    body: "{}",
    source: { connection: "movies", url: "https://api.example.com/lists/1/items", receivedAt: "" },
  };
  const needsPermission = () => new BridgeError("needs-permission", "Not allowed yet.");

  // A server that refuses changes until `allowWrites` is asked, and a host that records it.
  function host() {
    let allowed = false;
    const asked: string[] = [];
    const deps = {
      ask: vi.fn((action: string) => {
        asked.push(action);
        if (action === "connections.list") {
          return Promise.resolve({
            connections: [{ name: "movies", origins: ["https://api.example.com"] }],
          });
        }
        if (action === "connections.allowWrites") allowed = true;
        return Promise.resolve({});
      }),
    } as unknown as Pick<StartDeps, "ask">;
    const sent: unknown[] = [];
    const connection = vi.fn((args: unknown) => {
      sent.push(args);
      return allowed ? Promise.resolve(answer) : Promise.reject(needsPermission());
    });
    return { deps, asked, sent, connection };
  }
  const context = { phase: "active" as const, call: {} };

  it("asks where and what, and on Allow keeps the permission and sends the change again", async () => {
    const { deps, asked, sent, connection } = host();
    const askToWrite = vi.fn(() => Promise.resolve(true));
    const onAllowed = vi.fn();
    const handler = withPermission(connection, "w1", "Movie finder", askToWrite, deps, onAllowed);
    await expect(handler(post, context)).resolves.toEqual(answer);
    // Said once the permission is kept, so an open details view shows it (A72).
    expect(onAllowed).toHaveBeenCalledOnce();
    expect(askToWrite).toHaveBeenCalledWith({
      tool: "Movie finder",
      connection: "movies",
      method: "POST",
      address: "https://api.example.com/lists/1/items",
      body: '{"title":"Alien"}',
    });
    expect(asked).toEqual(["connections.list", "connections.allowWrites"]);
    expect(deps.ask).toHaveBeenCalledWith("connections.allowWrites", {
      workspaceId: "w1",
      connection: "movies",
    });
    expect(sent).toHaveLength(2);
    // Allowed now: the next change goes straight through, without asking.
    await expect(handler(post, context)).resolves.toEqual(answer);
    expect(askToWrite).toHaveBeenCalledOnce();
  });

  it("on Don't allow, or with no one to ask, the tool hears it wasn't allowed and nothing is kept", async () => {
    for (const askToWrite of [vi.fn(() => Promise.resolve(false)), undefined]) {
      const { deps, asked, sent, connection } = host();
      const handler = withPermission(connection, "w1", "Movie finder", askToWrite, deps);
      await expect(handler(post, context)).rejects.toMatchObject({ code: "not-allowed" });
      expect(asked).not.toContain("connections.allowWrites");
      expect(sent).toHaveLength(1);
    }
  });

  it("asks once for changes made while the question is open, and passes any other refusal on", async () => {
    const { deps, connection } = host();
    let allow!: (allowed: boolean) => void;
    const askToWrite = vi.fn(() => new Promise<boolean>((resolve) => (allow = resolve)));
    const handler = withPermission(connection, "w1", "Movie finder", askToWrite, deps);
    const first = handler(post, context);
    const second = handler({ ...post, body: "{}" }, context);
    await vi.waitFor(() => expect(askToWrite).toHaveBeenCalledOnce());
    allow(true);
    await expect(Promise.all([first, second])).resolves.toEqual([answer, answer]);
    expect(askToWrite).toHaveBeenCalledOnce();
    // Another refusal, such as a read the server refused, is never turned into a question.
    const refused = withPermission(
      () => Promise.reject(new BridgeError("not-active", "Wait.")),
      "w1",
      "Movie finder",
      askToWrite,
      deps,
    );
    await expect(refused(post, context)).rejects.toMatchObject({ code: "not-active" });
    expect(askToWrite).toHaveBeenCalledOnce();
  });
});

describe("the question before a tool's first change (A70, GEN-12)", () => {
  const question = {
    tool: "Movie finder",
    connection: "movies",
    method: "DELETE" as const,
    address: "https://api.example.com/lists/1",
    body: Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n"),
  };
  it("says where it goes and what it sends, cut to a few lines with a way to see it all", () => {
    const html = renderToStaticMarkup(<WriteQuestion question={question} onAnswer={() => {}} />);
    expect(html).toContain("Movie finder wants to delete something through movies");
    expect(html).toContain("It goes to https://api.example.com/lists/1");
    expect(html).toContain("line 5");
    expect(html).toContain("Show all 8 lines");
    expect(html).toContain("Tessera can&#x27;t undo a change made outside it.");
    expect(html).toContain(">Allow<");
    expect(html).toContain(">Don&#x27;t allow<");
    // A change with no text says so, rather than showing an empty box.
    const bare = renderToStaticMarkup(
      <WriteQuestion question={{ ...question, method: "POST", body: null }} onAnswer={() => {}} />,
    );
    expect(bare).toContain("wants to send something");
    expect(bare).toContain("It sends no text with it.");
    expect(bare).not.toContain("Show all");
  });
});
