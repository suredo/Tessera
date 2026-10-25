import type { MountedTool, ToolRuntime } from "@tessera/runtime";
import { describe, expect, it, vi } from "vitest";
import { startTool, type StartDeps } from "../src/tool-start.ts";

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
