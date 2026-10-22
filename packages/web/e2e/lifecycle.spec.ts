import { expect, test, type Page } from "@playwright/test";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";

// One active runtime (RUN-02) and the tool's place across a reload (UX-07), in Chrome and Edge
// (TEST-06), through the runtime's own createRuntime on the shared test page.

// Each says which run of its page it is, then ticks every 100 ms: its timer shows it still runs.
const ticker = (name: string) => ({
  html: `<p>${name}</p>`,
  css: "",
  js: `const run = Math.random().toString(36).slice(2); let tick = 0;
setInterval(() => tessera.send({ tool: ${JSON.stringify(name)}, run, tick: ++tick }), 100);`,
});

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({ first: ticker("first"), second: ticker("second") });
});
test.afterAll(() => host.close());

type Tick = { tool: string; run: string; tick: number };
type Mounted = {
  send(message: unknown): void;
  onMessage(listen: (message: unknown) => void): void;
};
type Runtime = {
  state(): { mode: string; mountId?: string };
  open(mountId: string): Promise<Mounted>;
  minimize(): void;
  restore(): Promise<Mounted>;
  close(): void;
  onState(listen: (state: unknown) => void): void;
};
type TestWindow = {
  createRuntime(container: HTMLElement, initial?: unknown): Runtime;
  runtime: Runtime;
  ticks: Tick[];
};

/**
 * Opens the test page with a runtime that keeps its state in sessionStorage, as the host app will
 * keep it, and starts from what was kept there.
 */
async function openHost(page: Page) {
  await page.goto(`${host.url}/`);
  await page.waitForFunction(() => "createRuntime" in window);
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const kept = sessionStorage.getItem("runtime");
    w.ticks = [];
    w.runtime = w.createRuntime(document.body, kept ? (JSON.parse(kept) as unknown) : undefined);
    w.runtime.onState((state) => sessionStorage.setItem("runtime", JSON.stringify(state)));
  });
}

/** Opens a tool in the page's runtime and keeps every tick it sends. */
const open = (page: Page, mountId: string) =>
  page.evaluate(async (mountId) => {
    const w = window as unknown as TestWindow;
    const tool = await w.runtime.open(mountId);
    tool.onMessage((message) => w.ticks.push(message as Tick));
  }, mountId);

const ticks = (page: Page) => page.evaluate(() => [...(window as unknown as TestWindow).ticks]);
const settle = (page: Page, ms: number) => page.waitForTimeout(ms);
// Waits until a tool has ticked, however long a busy machine takes to start it.
const ticked = (page: Page, tool: string, after = 0) =>
  expect
    .poll(async () => (await ticks(page)).slice(after).some((tick) => tick.tool === tool), {
      timeout: 15_000,
    })
    .toBe(true);
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as TestWindow).runtime.state());

// The tool frames running in the page, by the tool each shows.
const runningTools = (page: Page) =>
  page
    .frames()
    .map((frame) => /\/runtime\/tool\?mount=(\w+)/.exec(frame.url())?.[1])
    .filter((mountId): mountId is string => mountId !== undefined);

test("RUN-02: opening another tool disposes the one before it", async ({ page }) => {
  await openHost(page);
  await open(page, "first");
  await ticked(page, "first");

  await open(page, "second");
  await ticked(page, "second");
  const firstTicks = (await ticks(page)).filter((tick) => tick.tool === "first").length;
  await settle(page, 600);
  // The first tool's timer stopped with its frame: no tick from it since.
  expect((await ticks(page)).filter((tick) => tick.tool === "first")).toHaveLength(firstTicks);
  expect((await ticks(page)).some((tick) => tick.tool === "second")).toBe(true);
  expect(runningTools(page)).toEqual(["second"]);
  expect(await page.locator("body > iframe").count()).toBe(1);
  expect(await state(page)).toEqual({ mode: "active", mountId: "second" });
});

test("RUN-02: of several quick opens, only the last one runs", async ({ page }) => {
  await openHost(page);
  const outcomes = await page.evaluate(async () => {
    const runtime = (window as unknown as TestWindow).runtime;
    const opens = ["first", "second", "first", "second"].map((mountId) => runtime.open(mountId));
    return (await Promise.allSettled(opens)).map((outcome) => outcome.status);
  });
  expect(outcomes).toEqual(["rejected", "rejected", "rejected", "fulfilled"]);
  await expect.poll(() => runningTools(page), { timeout: 15_000 }).toEqual(["second"]);
  expect(await page.locator("body > iframe").count()).toBe(1);
});

test("RUN-02: minimizing disposes the tool's frames, channel and timers", async ({ page }) => {
  await openHost(page);
  await open(page, "first");
  await ticked(page, "first");
  const before = await ticks(page);

  await page.evaluate(() => (window as unknown as TestWindow).runtime.minimize());
  expect(await state(page)).toEqual({ mode: "minimized", mountId: "first" });
  expect(runningTools(page)).toEqual([]);
  expect(await page.locator("body > iframe").count()).toBe(0);
  const atMinimize = (await ticks(page)).length;
  await settle(page, 600);
  expect(await ticks(page)).toHaveLength(atMinimize);

  // Restored, it starts again from scratch: a new run, counting from one.
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const tool = await w.runtime.restore();
    tool.onMessage((message) => w.ticks.push(message as Tick));
  });
  await ticked(page, "first", atMinimize);
  const after = (await ticks(page)).slice(atMinimize);
  expect(after[0]?.tick).toBe(1);
  expect(after[0]?.run).not.toBe(before[0]?.run);
  expect(runningTools(page)).toEqual(["first"]);
});

test("UX-07: a minimized tool is still minimized after a reload, and an open one is open", async ({
  page,
}) => {
  await openHost(page);
  await open(page, "first");
  await page.evaluate(() => (window as unknown as TestWindow).runtime.minimize());

  await openHost(page);
  expect(await state(page)).toEqual({ mode: "minimized", mountId: "first" });
  await settle(page, 600);
  expect(runningTools(page)).toEqual([]);
  expect(await ticks(page)).toEqual([]);

  await page.evaluate(() => (window as unknown as TestWindow).runtime.restore());
  await openHost(page);
  expect(await state(page)).toEqual({ mode: "active", mountId: "first" });
  await expect.poll(() => runningTools(page)).toEqual(["first"]);
});
