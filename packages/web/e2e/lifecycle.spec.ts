import { expect, test, type Page } from "@playwright/test";
import { startSandboxHost, type SandboxHost } from "./support/sandbox-host.ts";

// One active runtime and its watchdog (RUN-02), and the tool's place across a reload (UX-07), in
// Chrome and Edge (TEST-06), through the runtime's own createRuntime on the shared test page.

// Each says which run of its page it is, then ticks every 100 ms: its timer shows it still runs.
const ticker = (name: string) => ({
  html: `<p>${name}</p>`,
  css: "",
  js: `const run = Math.random().toString(36).slice(2); let tick = 0;
setInterval(() => tessera.send({ tool: ${JSON.stringify(name)}, run, tick: ++tick }), 100);`,
});

let host: SandboxHost;
test.beforeAll(async () => {
  host = await startSandboxHost({
    first: ticker("first"),
    second: ticker("second"),
    // Says it's ready, answers each message, or spins for good when told to.
    spinner: {
      html: "<p>Spinner</p>",
      css: "",
      js: 'tessera.send({ tool: "spinner", ready: true }); tessera.onMessage((m) => { if (m === "spin") for (;;) {} tessera.send({ tool: "spinner", echo: m }); });',
    },
    // Spins from the moment it starts.
    stuck: { html: "<p>Stuck</p>", css: "", js: "for (;;) {}" },
    // Leaves its page as soon as it starts, until the wrapper stops it (SBX-07).
    runaway: { html: "<p>Runaway</p>", css: "", js: 'location.href = "about:blank";' },
    // Says it's ready; then busy for a second and a half, under the watchdog's limit, then answers.
    slow: {
      html: "<p>Slow</p>",
      css: "",
      js: 'tessera.send({ tool: "slow", ready: true }); tessera.onMessage((m) => { const end = Date.now() + 1500; while (Date.now() < end) {} tessera.send({ tool: "slow", done: m }); });',
    },
  });
});
test.afterAll(() => host.close());

type Tick = {
  tool: string;
  run?: string;
  tick?: number;
  echo?: string;
  done?: string;
  ready?: boolean;
};
// Short timings, so a stuck tool is stopped within seconds (the defaults are 1 s, 5 s and 10 s).
// The slow tool works for 1.5 s, so a busy machine still leaves it room under the limit.
const WATCHDOG = { pingMs: 200, unresponsiveMs: 4000, startupMs: 6000 };
type Mounted = {
  send(message: unknown): void;
  onMessage(listen: (message: unknown) => void): void;
  onEvent(listen: (event: string) => void): void;
};
type Runtime = {
  state(): { mode: string; mountId?: string; reason?: string };
  current(): Mounted | undefined;
  open(mountId: string): Promise<Mounted>;
  minimize(): void;
  restore(): Promise<Mounted>;
  close(): void;
  onState(listen: (state: unknown) => void): void;
};
type TestWindow = {
  events: string[];
  createRuntime(
    container: HTMLElement,
    initial: unknown,
    appLocation: Location,
    watchdog: object,
  ): Runtime;
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
  await page.evaluate((watchdog) => {
    const w = window as unknown as TestWindow;
    const kept = sessionStorage.getItem("runtime");
    w.ticks = [];
    w.events = [];
    const initial = kept ? (JSON.parse(kept) as unknown) : undefined;
    w.runtime = w.createRuntime(document.body, initial, location, watchdog);
    w.runtime.onState((state) => sessionStorage.setItem("runtime", JSON.stringify(state)));
  }, WATCHDOG);
}

/**
 * Waits until a tool says it's ready, within the watchdog's startup allowance: open() resolves
 * once the wrapper loads, while the tool's page may still be starting. Work sent after this gets a
 * deadline of its own, not one shared with the start.
 */
const readied = (page: Page, tool: string, after = 0) =>
  expect
    .poll(async () => (await ticks(page)).slice(after).some((t) => t.tool === tool && t.ready), {
      timeout: WATCHDOG.startupMs + 5000,
    })
    .toBe(true);
// Waits for a reply to work sent to a ready tool: the 1.5 s of work, with room for a busy machine.
const replied = (page: Page, check: (tick: Tick) => boolean) =>
  expect.poll(async () => (await ticks(page)).some(check), { timeout: 10_000 }).toBe(true);

/** Sends the running tool a message. */
const sendTool = (page: Page, message: unknown) =>
  page.evaluate(
    (message) => (window as unknown as TestWindow).runtime.current()?.send(message),
    message,
  );
// Waits for the runtime to reach a state.
const reaches = (page: Page, expected: object, timeout = 15_000) =>
  expect.poll(() => state(page), { timeout }).toEqual(expected);

/** Opens a tool in the page's runtime and keeps every tick it sends. */
const open = (page: Page, mountId: string) =>
  page.evaluate(async (mountId) => {
    const w = window as unknown as TestWindow;
    const tool = await w.runtime.open(mountId);
    tool.onMessage((message) => w.ticks.push(message as Tick));
    tool.onEvent((event) => w.events.push(event));
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

test("RUN-02: the watchdog stops a tool stuck in a busy loop, and the host stays responsive", async ({
  page,
}) => {
  await openHost(page);
  await open(page, "spinner");
  await readied(page, "spinner");
  await sendTool(page, "hello");
  await replied(page, (t) => t.echo === "hello");

  await sendTool(page, "spin");
  // The host page runs apart from the tool: it answers at once while the tool spins.
  const started = Date.now();
  await page.evaluate(() => document.title);
  expect(Date.now() - started).toBeLessThan(1000);
  await reaches(page, { mode: "stopped", mountId: "spinner", reason: "unresponsive" });
  // A frame of a stuck process can take a moment to be reported gone.
  await expect.poll(() => runningTools(page), { timeout: 10_000 }).toEqual([]);
  expect(await page.locator("body > iframe").count()).toBe(0);

  // Restored, it starts again and answers.
  const beforeRestore = (await ticks(page)).length;
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const tool = await w.runtime.restore();
    tool.onMessage((message) => w.ticks.push(message as Tick));
  });
  await readied(page, "spinner", beforeRestore);
  await sendTool(page, "again");
  await replied(page, (t) => t.echo === "again");
  expect(await state(page)).toEqual({ mode: "active", mountId: "spinner" });
});

test("RUN-02: a tool stuck while it starts is stopped too", async ({ page }) => {
  await openHost(page);
  await open(page, "stuck");
  await reaches(page, { mode: "stopped", mountId: "stuck", reason: "unresponsive" });
  // A frame of a stuck process can take a moment to be reported gone.
  await expect.poll(() => runningTools(page), { timeout: 10_000 }).toEqual([]);
});

test("RUN-02: a tool that is busy for a while, under the limit, keeps running", async ({
  page,
}) => {
  await openHost(page);
  await open(page, "slow");
  await readied(page, "slow");
  await sendTool(page, "work");
  await replied(page, (t) => t.done === "work");
  await settle(page, 1000);
  expect(await state(page)).toEqual({ mode: "active", mountId: "slow" });
  expect(runningTools(page)).toEqual(["slow"]);
});

test("UX-07: a stopped tool is still stopped after a reload", async ({ page }) => {
  await openHost(page);
  await open(page, "stuck");
  await reaches(page, { mode: "stopped", mountId: "stuck", reason: "unresponsive" });
  await openHost(page);
  expect(await state(page)).toEqual({ mode: "stopped", mountId: "stuck", reason: "unresponsive" });
  await settle(page, 600);
  expect(runningTools(page)).toEqual([]);
});

test("RUN-02: whoever opened a tool hears why it stopped, as the runtime does", async ({
  page,
}) => {
  await openHost(page);
  await open(page, "stuck");
  await reaches(page, { mode: "stopped", mountId: "stuck", reason: "unresponsive" });
  expect(await page.evaluate(() => (window as unknown as TestWindow).events)).toEqual([
    "unresponsive",
  ]);

  await openHost(page);
  await page.evaluate(() => (window as unknown as TestWindow).runtime.close());
  await open(page, "runaway");
  await reaches(page, { mode: "stopped", mountId: "runaway", reason: "kept leaving its page" });
  expect(await page.evaluate(() => (window as unknown as TestWindow).events)).toEqual([
    "restarted",
    "restarted",
    "restarted",
    "stopped",
  ]);
});

test("RUN-02: setting the computer's clock forward doesn't stop a tool", async ({ page }) => {
  await openHost(page);
  await open(page, "slow");
  await readied(page, "slow");
  await sendTool(page, "warm up");
  await replied(page, (t) => t.done === "warm up");
  // The tool works for a second and a half, within its limit, so the pings sent meanwhile wait
  // for an answer; then the clock jumps a minute ahead, as a correction would make it.
  await sendTool(page, "work");
  await settle(page, 500);
  await page.evaluate(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 60_000;
  });
  await replied(page, (t) => t.done === "work");
  await settle(page, 1000);
  expect(await state(page)).toEqual({ mode: "active", mountId: "slow" });
});
