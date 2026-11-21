// Docs: docs/code/evals/runner.md
// A live run is LIVE: it calls a model, so it needs an approved budget first (ENG-07,
// docs/practices/live-evaluation.md). A rehearsal and a replay call none.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";
import {
  createWorkspace,
  getWorkspace,
  launch,
  listSavedTools,
  listWorkspaces,
  type Provider,
  type Store,
  type TwoPassOptions,
} from "@tessera/server";
import { refuseRealDataFolder, startHarness, type LedgerSummary } from "../harness/index.ts";
import {
  checkFacts,
  readHostState,
  stepKind,
  type DoAction,
  type Scenario,
  type Step,
  type StepOutcome,
  type StepTarget,
} from "../scenarios/index.ts";
import { featuresMissed, outcomeOf, say } from "./messages.ts";
import {
  clickWorkspaceAction,
  closeWorkspaces,
  openAppSection,
  selectWorkspace,
} from "../../../packages/web/e2e/support/workspace-actions.ts";
import { startServices, type Services } from "./services.ts";

// The scenario runner (EVAL-01, EVAL-02): it starts an empty Tessera on the run's own data folder,
// with every model call going through the harness (cap and ledger), and plays a scenario's steps
// through the host app in Chrome, as a person would. After each step it reads what Tessera stored
// and checks the step's host facts. The report says what passed, what failed and why, and what
// the run cost.

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, "../../../packages/web/dist");
/** The files a scenario's person may pick (A80): only these, never the real ones. */
const SCENARIO_FILES = path.resolve(here, "../../scenarios/files");
/** How long one request may take before the step fails (GEN-11's limits are the pipeline's). */
export const STEP_LIMIT_MS = 8 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** The title of the empty workspace a `switch: new` step opens. */
export const NEW_WORKSPACE = "New workspace";

export type RunMode = "rehearsal" | "replay" | "live";

export type StepResult = {
  index: number;
  kind: ReturnType<typeof stepKind>;
  /** What the person did: the request, or what was saved, opened or undone. */
  action: string;
  outcome: "passed" | "failed" | "blocked";
  /** The host's notice after the step, as the person read it. */
  notice: string;
  problems: string[];
  seconds: number;
  /**
   * The ledger's calls this step asked for, by index, from `from` up to but not including `to`,
   * so its time is matched to its own calls (OBS-04); missing in reports from before it.
   */
  calls?: { from: number; to: number };
  /**
   * What the step's screenshot shows of the tool (L-81): the tool, an empty panel after waiting
   * for it, or no tool at all; left out for a step that didn't run.
   */
  screenshot?: Screenshot;
};

export type Screenshot = "tool" | "empty" | "no tool";

export type RunReport = {
  scenario: string;
  mode: RunMode;
  startedAt: string;
  seconds: number;
  steps: StepResult[];
  /** Why the run stopped early, if it did. */
  stopped?: string;
  /** The hard cap the run had: the approved one, at most the scenario file's budget (ENG-07). */
  callCap: number;
  /** A replay recorded with other prompt parts: it ran, but its evidence is stale (ENG-16). */
  stale: string[];
  /** Whether big tools were made in two passes (GEN-17); missing in reports from before it. */
  twoPass?: boolean;
  ledger: LedgerSummary;
  folder: string;
};

/** A step's action in a few words, for the report. */
const actionOf = (s: Step): string => {
  const kind = stepKind(s);
  const value = (s as Record<string, unknown>)[kind];
  return value === true
    ? kind
    : `${kind}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
};

/**
 * The instant a wall-clock time names in a time zone (RUN-07): "2026-10-12T09:00:00" in
 * America/Sao_Paulo is 12:00 UTC. Found from the zone's offset at that time, checked once more
 * across a daylight-saving change.
 */
export function zonedInstant(local: string, zone: string): number {
  const asUtc = Date.parse(`${local}Z`);
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(instant)
        .map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(
      Number(parts["year"]),
      Number(parts["month"]) - 1,
      Number(parts["day"]),
      Number(parts["hour"]),
      Number(parts["minute"]),
      Number(parts["second"]),
    );
    return wall - instant;
  };
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}

/** Plays one scenario and writes its report beside the run's ledger. */
export async function runScenario(
  scenario: Scenario,
  options: {
    mode: RunMode;
    provider: Provider;
    folder: string;
    /** Called once the run's Tessera is up, with its store, before the first step. */
    onStarted?: (store: Store) => void;
    /** Calls the answers didn't fit (a rehearsal's or replay's); each one fails its step. */
    misfits?: () => readonly string[];
    /** Called with the run's store once the steps are done, before Tessera stops. */
    onFinished?: (store: Store) => void;
    /** Calls a replay answered with answers recorded under other prompt parts. */
    stale?: () => readonly string[];
    /** The approved hard cap; the scenario file's budget when left out, and never above it. */
    callCap?: number;
    /** The browser's web build and launcher; tests pass their own. */
    webRoot?: string;
    launchBrowser?: () => Promise<Browser>;
    /** Makes big tools in two passes (GEN-17), for comparing them with one pass. */
    twoPass?: TwoPassOptions;
    /**
     * Records the run's video into its folder. The command line always does, as an evaluation's
     * evidence (ENG-07); a browser test only when asked with TESSERA_E2E_RECORD=1 (A56).
     */
    recordVideo?: boolean;
  },
): Promise<RunReport> {
  // The cap first: it is what the owner approved, so it is checked before anything else.
  const callCap = options.callCap ?? scenario.budget.calls;
  if (!Number.isInteger(callCap) || callCap < 1 || callCap > scenario.budget.calls) {
    throw new Error(
      `The cap must be a whole number from 1 to ${scenario.id}'s budget of ${scenario.budget.calls}, not ${callCap}.`,
    );
  }
  // A clock ahead of the real one makes the browser judge every deadline the server set as past,
  // so each request would time out (L-83). Refused before anything starts or is spent.
  if (zonedInstant(scenario.clock.start, scenario.clock.zone) > Date.now()) {
    throw new Error(
      `${scenario.id}'s clock starts at ${scenario.clock.start}, after now; start it in the past.`,
    );
  }
  const webRoot = options.webRoot ?? WEB_ROOT;
  if (!fs.existsSync(path.join(webRoot, "index.html"))) throw new Error("Build first: pnpm build.");
  const folder = path.resolve(options.folder);
  const dataDir = path.join(folder, "tessera");
  refuseRealDataFolder(dataDir);
  const harness = startHarness({
    provider: options.provider,
    mode: options.mode === "live" ? "live" : "dry-run",
    callCap,
    dataFolder: path.join(folder, "harness"),
  });
  // The host's clock starts at the scenario's time, in its zone, and moves only on a next-day
  // step (RUN-07).
  const start = zonedInstant(scenario.clock.start, scenario.clock.zone);
  const started = Date.now();
  let offset = 0;
  const now = () => new Date(start + offset + (Date.now() - started));
  const launchOn = (dir: string) => ({
    dataDir: dir,
    port: 0,
    webRoot,
    provider: harness.provider,
    now,
    openBrowser: () => Promise.resolve(),
    ...(options.twoPass ? { twoPass: options.twoPass } : {}),
    // The scenario's own switch for checks from the request (VER-09), off unless it says so, so a
    // recording made without them still replays; Tessera has them on otherwise (A57).
    acceptanceChecks: scenario.acceptanceChecks,
    ...(options.mode === "live"
      ? {}
      : {
          setup: {
            findClaude: () =>
              Promise.resolve({ ok: true as const, executable: "rehearsal", version: "0.0.0" }),
            findCodex: () =>
              Promise.resolve({ ok: true as const, executable: "rehearsal", version: "0.0.0" }),
          },
        }),
  });
  const first = await launch(launchOn(dataDir));
  if (first.status !== "started") throw new Error(`Tessera didn't start: ${first.status}`);
  let app = first;
  let store = app.dataFolder;
  let services: Services | undefined;
  options.onStarted?.(store);
  const results: StepResult[] = scenario.steps.map((s, index) => ({
    index: index + 1,
    kind: stepKind(s),
    action: actionOf(s),
    outcome: "blocked",
    notice: "",
    problems: [],
    seconds: 0,
  }));
  let stopped: string | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const misfits = () => options.misfits?.() ?? [];
  try {
    // The scenario's outside services, fakes on loopback, added as the person's connections before
    // any step, so no run reaches a real service (CAP-02, ADR 0015); inside the guard, so one that
    // won't start still stops Tessera and leaves a report (#372 review).
    services = await startServices(store, scenario.services);
    // Inside the guard, so a browser that won't start still stops Tessera and leaves a report.
    browser = await (options.launchBrowser ?? (() => chromium.launch({ channel: "chrome" })))();
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      timezoneId: scenario.clock.zone,
      locale: scenario.language,
      ...(options.recordVideo ? { recordVideo: { dir: folder } } : {}),
    });
    await context.clock.install({ time: start });
    const page = await context.newPage();
    await page.goto(app.url);
    await requestBox(page).waitFor();

    for (let index = 0; index < scenario.steps.length; index++) {
      const s = scenario.steps[index]!;
      const result = results[index]!;
      const began = Date.now();
      const before = readHostState(store, await openWorkspace(page));
      const misfitsBefore = misfits().length;
      const callsFrom = harness.callsAsked();
      const target: StepTarget = {};
      let outcome: StepOutcome = { claim: "none" };
      try {
        // A request a cancel step stops is sent, not waited for: the cancel is checked instead.
        const cancelledNext = "cancel" in (scenario.steps[index + 1] ?? {});
        outcome = await play(page, s, {
          store,
          target,
          cancelledNext,
          nextDay: async () => {
            offset += DAY_MS;
            await context!.clock.setSystemTime(now());
          },
          // Another computer: Tessera started on a new, empty data folder, the same clock and
          // provider, and the page opened on it; the old one stops (DATA-05, P2).
          move: async () => {
            const movedDir = path.join(folder, "tessera-moved");
            refuseRealDataFolder(movedDir);
            const moved = await launch(launchOn(movedDir));
            if (moved.status !== "started")
              throw new Error(`Tessera didn't start: ${moved.status}`);
            await app.stop();
            app = moved;
            store = moved.dataFolder;
            // Whoever follows the run's Tessera, as replay's saved-tool lookup does, follows it here.
            options.onStarted?.(store);
            await page.goto(app.url);
            return store;
          },
        });
        const after = readHostState(store, await openWorkspace(page));
        result.notice = cancelledNext ? "Sent; the next step cancels it." : await said(page, s);
        result.problems = cancelledNext ? [] : checkFacts(before, after, outcome, s.expect, target);
        // A big tool's core standing isn't a pass when a feature after it wasn't added (GEN-17).
        if (!cancelledNext && "say" in s) result.problems.push(...featuresMissed(result.notice));
      } catch (error) {
        result.problems = [error instanceof Error ? error.message.split("\n")[0]! : String(error)];
        result.notice = await said(page, s).catch(() => "");
      }
      // Answers that didn't fit fail the step whatever the host showed (TEST-04).
      result.problems.push(...misfits().slice(misfitsBefore));
      result.outcome = result.problems.length === 0 ? "passed" : "failed";
      result.seconds = (Date.now() - began) / 1000;
      result.calls = { from: callsFrom, to: harness.callsAsked() };
      result.screenshot = await toolShown(page);
      // The whole page, so a tool its panel fits shows whole, not cut at the window (A89). Taking
      // it scrolls the host page, which a tool may notice; one that saved because of it would
      // change the next step's start, so that fails this step instead of passing unseen. A save it
      // put off is watched for too, for PICTURE_WATCH_MS after a picture that scrolled.
      const pictured = await openWorkspace(page);
      const revision = pictured ? getWorkspace(store, pictured)?.dataRevision : undefined;
      const scrolled = await wholePage(page, path.join(folder, `step-${result.index}.png`));
      const watched = scrolled ? PICTURE_WATCH_MS : 0;
      const read = () => (pictured ? getWorkspace(store, pictured)?.dataRevision : undefined);
      if (pictured && (await changedWithin(read, revision, watched))) {
        result.problems.push("The tool changed its data while the screenshot was taken.");
        result.outcome = "failed";
      }
      // Everything after depends on the first step, so a failed first step ends the run.
      if (index === 0 && result.outcome === "failed") {
        stopped = "The first step failed, so the steps after it can't be judged.";
        break;
      }
    }
  } catch (error) {
    stopped = error instanceof Error ? error.message : String(error);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      options.onFinished?.(store);
    } catch (error) {
      stopped ??= error instanceof Error ? error.message : String(error);
    }
    await app.stop();
    await services?.close();
  }
  const report: RunReport = {
    scenario: scenario.id,
    mode: options.mode,
    startedAt: new Date(start).toISOString(),
    seconds: (Date.now() - started) / 1000,
    steps: results,
    ...(stopped ? { stopped } : {}),
    callCap,
    stale: [...(options.stale?.() ?? [])],
    twoPass: options.twoPass !== undefined,
    ledger: harness.finish(),
    folder,
  };
  fs.writeFileSync(path.join(folder, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const requestBox = (page: Page) => page.getByRole("textbox", { name: say("request.label") });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The workspace the host app has open, from its tool panel's stable hook (VER-03). */
async function openWorkspace(page: Page): Promise<string | null> {
  const panel = page.locator(".tool-panel[data-workspace-id]");
  return (await panel.count()) === 0 ? null : panel.first().getAttribute("data-workspace-id");
}

/**
 * Waits, briefly, for the open tool to show something: after a workspace opens or its data
 * changes, the tool's nested frames load again, and a screenshot taken at once shows an empty
 * panel (L-81). Only the screenshot waits; the facts are already read, and a tool that never
 * shows anything is left for the smoke check and the person reading the screenshots to see.
 */
async function toolShown(page: Page): Promise<Screenshot> {
  if ((await page.locator(".tool-frame iframe").count()) === 0) return "no tool";
  return toolFrame(page)
    .locator("body *:visible")
    .first()
    .waitFor({ timeout: 5_000 })
    .then(
      () => "tool" as const,
      () => "empty" as const,
    );
}

/**
 * A screenshot of the whole page, so a tool its panel fits shows whole, not cut at the window
 * (A89). The page is never resized (ENG-14): Playwright's full-page picture resizes it and lays the
 * tool's nested frames, each in a process of its own, out at the wrong size. Instead the host page
 * is scrolled a window at a time, each window pictured as it is, and scrolled back; scrolling the
 * host page changes nothing in the tool's frames, which keep their size. The pictures are joined on
 * a canvas in a page of their own, in a separate context, so the run's page is not touched. Says
 * whether it scrolled.
 */
export async function wholePage(page: Page, file: string): Promise<boolean> {
  const viewport = page.viewportSize();
  // Evaluated in the page, as text: the runner's own code has no page types.
  const total = Number(await page.evaluate("document.documentElement.scrollHeight"));
  const browser = page.context().browser();
  if (!viewport || !browser || !(total > viewport.height)) {
    await page.screenshot({ path: file });
    return false;
  }
  const scrolled = Number(await page.evaluate("scrollY"));
  const slices: { top: number; png: string }[] = [];
  for (let top = 0; ; top += viewport.height) {
    const y = Math.min(top, total - viewport.height);
    await page.evaluate(`scrollTo(0, ${y})`);
    await page.waitForTimeout(150);
    slices.push({ top: y, png: (await page.screenshot()).toString("base64") });
    if (y + viewport.height >= total) break;
  }
  await page.evaluate(`scrollTo(0, ${scrolled})`);
  const joining = await browser.newContext();
  try {
    const joiner = await joining.newPage();
    const joined = await joiner.evaluate(joinSlices(slices, viewport.width, total));
    fs.writeFileSync(file, Buffer.from(String(joined), "base64"));
  } finally {
    await joining.close();
  }
  return true;
}

/** How long after a whole-page picture that scrolled the runner watches the tool's data, in ms. */
export const PICTURE_WATCH_MS = 2_000;

/**
 * Whether `read` gives something other than `before` now or within `ms`, read every `everyMs`: a
 * save a tool made, or put off, after the picture scrolled the host page (A89).
 */
export async function changedWithin<T>(
  read: () => T,
  before: T,
  ms: number,
  everyMs = 100,
): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (read() !== before) return true;
    if (Date.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/** The script that joins `slices`, each a window's picture at its top, into one PNG, as base64. */
const joinSlices = (slices: { top: number; png: string }[], width: number, total: number) =>
  `(async (slices, width, total) => {
  const images = await Promise.all(slices.map((slice) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = "data:image/png;base64," + slice.png;
  })));
  const scale = images[0].naturalWidth / width;
  const canvas = document.createElement("canvas");
  canvas.width = images[0].naturalWidth;
  canvas.height = Math.round(total * scale);
  const context = canvas.getContext("2d");
  images.forEach((image, i) => context.drawImage(image, 0, Math.round(slices[i].top * scale)));
  return canvas.toDataURL("image/png").split(",")[1];
})(${JSON.stringify(slices)}, ${width}, ${total})`;

/** The open tool's own page, inside the host's frame and the wrapper's (RUN-01). */
const toolFrame = (page: Page) =>
  page.frameLocator(".tool-frame iframe").frameLocator("iframe").frameLocator("iframe");

/** How long a do step waits for its control's save, and the quiet that ends it (EVAL-01). */
export const DO_WAIT = { changeMs: 10_000, quietMs: 1_000 } as const;

/**
 * Waits for a control's effect on the open workspace's data (EVAL-01, EVAL-02): its save goes
 * through the bridge after the click, perhaps after a read or a delay, so every step waits for the
 * first change, up to ten seconds, whatever it expects: a step expecting the data unchanged is
 * watched as long, so a late write fails it instead of passing it. Once the data has changed, it
 * waits until it has been quiet for a second. Only then are the step's facts read, so a save
 * within that window is the step's own; one later still is the next step's.
 */
export async function dataSettled(
  revision: () => number | undefined,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<void> {
  const tick = 100;
  const first = revision();
  let waited = 0;
  // Until the data first changes, or the window ends.
  while (waited < DO_WAIT.changeMs && revision() === first) {
    await wait(tick);
    waited += tick;
  }
  if (revision() === first) return;
  // Then until it is quiet, within the same overall bound.
  let last = revision();
  let quiet = 0;
  while (quiet < DO_WAIT.quietMs && waited < DO_WAIT.changeMs + DO_WAIT.quietMs) {
    await wait(tick);
    waited += tick;
    const now = revision();
    quiet = now === last ? quiet + tick : 0;
    last = now;
  }
}

/**
 * Uses one of the open tool's controls, as the person would (EVAL-01): finds the one shown element
 * marked with the step's hook, inside the one shown element `in` names when it names one, and
 * clicks it or types the value into it; a select takes the choice whose text or value it is. A
 * hook the tool doesn't show once, or shows more than once, fails the step in plain words.
 */
async function useControl(page: Page, action: DoAction): Promise<void> {
  const tool = toolFrame(page);
  const marked = (hook: string) => `[data-hook~="${hook}"]:visible`;
  const hook = "click" in action ? action.click : action.fill;
  let scope = tool.locator("body");
  if (action.in) {
    const holders = tool.locator(marked(action.in.hook)).filter({ hasText: action.in.text });
    const count = await holders.count();
    if (count !== 1) {
      throw new Error(
        `The tool shows ${count} elements marked ${action.in.hook} with "${action.in.text}"; the step needs one.`,
      );
    }
    scope = holders;
  }
  // Of several, the one whose label shows the step's text, as a person finds a form's field.
  const candidates = scope.locator(marked(hook));
  const labelled = action.label ? candidates.and(tool.getByLabel(action.label)) : candidates;
  // Of several that each do what the hook says, as one of an editor's edits, the first.
  const first = "click" in action && action.first === true;
  const control = first ? labelled.first() : labelled;
  const count = await labelled.count();
  if (count === 0 || (count !== 1 && !first)) {
    throw new Error(
      `The tool shows ${count} elements marked ${hook}${action.label ? ` labelled "${action.label}"` : ""}${action.in ? ` there` : ""}; the step needs one.`,
    );
  }
  if ("click" in action) {
    // A click that opens the browser's picker: the person picks the scenario's file (A80).
    const file = action.pick ? path.join(SCENARIO_FILES, action.pick) : undefined;
    if (file && !fs.existsSync(file))
      throw new Error(`The scenario's file ${action.pick} isn't in evals/scenarios/files.`);
    if (file) {
      await clickAndPick(
        () => page.waitForEvent("filechooser", { timeout: 15_000 }),
        () => control.click(),
        file,
        action.pick!,
      );
    } else {
      await control.click();
    }
    // A click that makes Tessera ask about saving a file: the person answers (A81).
    if (action.answer) {
      const question = page.getByRole("alertdialog", { name: say("save.label") });
      await question.waitFor({ timeout: 15_000 }).catch(() => {
        throw new Error("Tessera didn't ask about saving a file.");
      });
      await question
        .getByRole("button", {
          name: say(action.answer === "save" ? "save.save" : "save.dontSave"),
          exact: true,
        })
        .click();
    }
  } else if ((await control.and(tool.locator("select")).count()) === 1) {
    // Playwright picks the choice whose value or text is the value, or fails saying it has none.
    await control.selectOption(action.value);
  } else {
    await control.fill(action.value);
  }
}

/**
 * Clicks, and picks `file` in the browser's file picker the click opens (A80). The wait for the
 * picker is watched from the start, so a click slower than it, or one that fails, never leaves it
 * unhandled (#382 review). No picker after the click fails plainly, naming the file.
 */
export async function clickAndPick(
  chooser: () => Promise<{ setFiles(file: string): Promise<void> }>,
  click: () => Promise<void>,
  file: string,
  name: string,
): Promise<void> {
  const opened = chooser().then(
    (picker) => picker,
    () => undefined,
  );
  await click();
  const picker = await opened;
  if (!picker) throw new Error(`No file picker opened for ${name}.`);
  await picker.setFiles(file);
}

/** Tessera's newest reply in the chat, where a request's outcome is said (APP-01), as text. */
async function reply(page: Page): Promise<string> {
  const shown = page.locator(".chat-log .from-tessera .chat-text");
  return (await shown.count()) === 0 ? "" : (await shown.last().innerText()).trim();
}

/** What the host said after a step: a request's reply in the chat, or the notice for the rest. */
const said = (page: Page, s: Step) => ("say" in s || "cancel" in s ? reply(page) : notice(page));

/** The newest notice the host app shows, as text. */
async function notice(page: Page): Promise<string> {
  // The main screen's notice, or the first-run screen's before any workspace exists.
  const shown = page.locator(".notice [role=status], main.empty > [role=status]");
  return (await shown.count()) === 0 ? "" : (await shown.first().innerText()).trim();
}

/** Waits for a request to finish: the box takes text again. */
const settled = (page: Page) => expect(requestBox(page)).toBeEnabled({ timeout: STEP_LIMIT_MS });

type Play = {
  store: Store;
  target: StepTarget;
  cancelledNext: boolean;
  nextDay: () => Promise<void>;
  /** Starts Tessera again on a new, empty data folder and opens the page on it. */
  move: () => Promise<Store>;
};

/** Does one step in the host app, as the person would, and reads what the host showed. */
async function play(page: Page, s: Step, run: Play): Promise<StepOutcome> {
  const { store, target } = run;
  const workspaceTitle = (id: string) => getWorkspace(store, id)?.title ?? "";
  if ("say" in s) {
    await requestBox(page).fill(s.say);
    await button(page, say("request.send")).click();
    if (run.cancelledNext) return { claim: "none" };
    await settled(page);
    // A change to existing entries waits for the person's review; the person applies it.
    const review = page.locator(".data-review");
    if (await review.isVisible()) {
      await review.getByRole("button", { name: say("request.reviewApply") }).click();
      await review.waitFor({ state: "detached", timeout: STEP_LIMIT_MS });
      await settled(page);
    }
    const shown = await reply(page);
    const offer = page.locator(".offer");
    const offeredName = (await offer.count())
      ? listSavedTools(store).find((t) =>
          shown.includes(say("request.offerSaved", { name: t.name }).split(".")[0]!),
        )
      : undefined;
    return { ...outcomeOf(shown), ...(offeredName ? { offered: offeredName.id } : {}) };
  }
  if ("cancel" in s) {
    await button(page, say("request.cancel")).click();
    await settled(page);
    return outcomeOf(await reply(page));
  }
  if ("save" in s) {
    const id = await openWorkspace(page);
    if (!id) throw new Error("No workspace is open to save.");
    await clickWorkspaceAction(page, say("workspaces.save", { name: workspaceTitle(id) }));
    await page.getByLabel(say("workspaces.saveLabel")).fill(s.save);
    await button(page, say("workspaces.saveConfirm")).click();
    await page.getByText(say("workspaces.savedAs", { name: s.save })).waitFor();
    await closeWorkspaces(page);
    return { claim: "none" };
  }
  if ("continue" in s || "use-again" in s) {
    const name = "continue" in s ? s.continue : s["use-again"];
    target.savedTool = name;
    const entry = listSavedTools(store).find((t) => t.name === name);
    if (!entry) throw new Error(`There is no saved tool named ${name}.`);
    const existing = new Set(listWorkspaces(store).map((w) => w.id));
    // From the offer when the host is offering it, otherwise from my tools.
    const offered = button(
      page,
      say("continue" in s ? "request.continue" : "request.useAgain", { name }),
    );
    if (await offered.count()) await offered.click();
    else {
      await openAppSection(page, say("nav.library"));
      await page
        .getByRole("button", {
          name:
            "continue" in s
              ? say("library.continueLabel", { name, workspace: workspaceTitle(entry.workspaceId) })
              : say("library.useAgainLabel", { name }),
          exact: true,
        })
        .click();
    }
    // The workspace it opens, not the one already showing: Continue's own, or a new one for
    // Use again. The panel before the switch would otherwise be read on a slow machine. If it
    // never opens, the host facts say so in their own words.
    await expect
      .poll(
        async () => {
          const id = await openWorkspace(page);
          return id !== null && ("continue" in s ? id === entry.workspaceId : !existing.has(id));
        },
        { timeout: 30_000 },
      )
      .toBe(true)
      .catch(() => undefined);
    return { claim: "none" };
  }
  if ("undo" in s) {
    // History is a panel, opened through the same control a person uses (APP-05).
    const history = page.getByRole("region", { name: say("history.heading") });
    if (!(await history.isVisible())) await button(page, say("history.heading")).click();
    await history.waitFor();
    if (s.undo === "data") {
      await history.getByRole("button", { name: say("history.undo") }).click();
      await page.getByText(say("history.undone")).waitFor();
    } else {
      const id = await openWorkspace(page);
      const versions = id
        ? await history.getByRole("button", { name: /^Restore version \d+$/ }).count()
        : 0;
      if (versions === 0) throw new Error("There is no earlier version to go back to.");
      // The newest earlier version: the history lists versions newest first.
      const restore = history.getByRole("button", { name: /^Restore version \d+$/ }).first();
      const label = (await restore.getAttribute("aria-label")) ?? (await restore.innerText());
      await restore.click();
      const confirm = page.getByRole("group", { name: `${label}?` });
      await confirm.getByRole("button", { name: say("history.confirm"), exact: true }).click();
      await page.getByText(/is back, as the newest version\./).waitFor();
    }
    await history.getByRole("button", { name: say("tool.closePanel"), exact: true }).click();
    return { claim: "none" };
  }
  if ("switch" in s) {
    if (s.switch === "new") {
      // The host app has no control for an empty workspace yet (#132): it is made the way the app
      // would, through the store, then opened in the app like any other.
      createWorkspace(store, NEW_WORKSPACE);
      await page.reload();
      await selectWorkspace(page, NEW_WORKSPACE);
    } else {
      await selectWorkspace(page, s.switch);
    }
    await page.locator(".tool-panel[data-workspace-id]").waitFor();
    return { claim: "none" };
  }
  if ("delete" in s) {
    const match = listWorkspaces(store).filter((w) => w.title === s.delete);
    if (match.length !== 1) throw new Error(`${match.length} workspaces are named ${s.delete}.`);
    target.trashes = match[0]!.id;
    await clickWorkspaceAction(page, say("workspaces.delete", { name: s.delete }));
    await page.getByText(say("workspaces.deleted", { name: s.delete })).waitFor();
    return { claim: "none" };
  }
  if ("restore" in s) {
    const firstScreen = button(page, say("home.trash"));
    if (await firstScreen.isVisible()) await firstScreen.click();
    else await openAppSection(page, say("nav.trash"));
    await button(page, say("trash.restoreLabel", { name: s.restore })).click();
    await page.getByText(say("trash.restored", { name: s.restore })).waitFor();
    return { claim: "none" };
  }
  if ("move" in s) {
    const id = await openWorkspace(page);
    if (!id) throw new Error("No workspace is open to move.");
    // Exported as the person would, with the host's own button, and imported on the new folder's
    // first screen from that file (APP-06, DATA-05).
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      clickWorkspaceAction(page, say("workspaces.export", { name: workspaceTitle(id) })),
    ]);
    const file = {
      name: download.suggestedFilename(),
      bytes: fs.readFileSync(await download.path()),
    };
    await run.move();
    await requestBox(page).waitFor();
    await page
      .getByLabel(say("archive.importLabel"))
      .setInputFiles({ name: file.name, mimeType: "application/octet-stream", buffer: file.bytes });
    await page
      .locator(`.tool-panel[data-workspace-id="${id}"]`)
      .waitFor({ timeout: STEP_LIMIT_MS });
    return { claim: "none" };
  }
  if ("reload" in s || "next-day" in s) {
    if ("next-day" in s) await run.nextDay();
    // Whatever the app opens after a reload is what the facts check: the runner never reopens it.
    await page.reload();
    await requestBox(page).waitFor();
    return { claim: "none" };
  }
  if ("do" in s) {
    const id = await openWorkspace(page);
    if (!id) throw new Error("No tool is open to use.");
    // Every file the browser saves during the step, by the name it was saved under (CAP-03).
    const downloaded: string[] = [];
    const saved = (download: Download) => downloaded.push(download.suggestedFilename());
    page.on("download", saved);
    try {
      await useControl(page, s.do);
      if ("answer" in s.do && s.do.answer === "save") {
        await expect
          .poll(() => downloaded.length, { timeout: 15_000 })
          .toBeGreaterThan(0)
          .catch(() => {});
      }
      await dataSettled(() => getWorkspace(store, id)?.dataRevision);
    } finally {
      page.off("download", saved);
    }
    return { claim: "none", ...(downloaded.length ? { downloaded } : {}) };
  }
  throw new Error(`The runner doesn't play ${stepKind(s)} steps.`);
}
