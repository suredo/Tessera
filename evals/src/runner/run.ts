// Docs: docs/code/evals/runner.md
// A live run is LIVE: it calls a model, so it needs an approved budget first (ENG-07,
// docs/practices/live-evaluation.md). A rehearsal and a replay call none.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  createWorkspace,
  getWorkspace,
  launch,
  listSavedTools,
  listWorkspaces,
  type Provider,
  type Store,
} from "@tessera/server";
import { refuseRealDataFolder, startHarness, type LedgerSummary } from "../harness/index.ts";
import {
  checkFacts,
  m2Problems,
  readHostState,
  stepKind,
  type Scenario,
  type Step,
  type StepOutcome,
  type StepTarget,
} from "../scenarios/index.ts";
import { outcomeOf, say } from "./messages.ts";

// The scenario runner (EVAL-01, EVAL-02): it starts an empty Tessera on the run's own data folder,
// with every model call going through the harness (cap and ledger), and plays a scenario's steps
// through the host app in Chrome, as a person would. After each step it reads what Tessera stored
// and checks the step's host facts. The report says what passed, what failed and why, and what
// the run cost.

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(here, "../../../packages/web/dist");
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
  },
): Promise<RunReport> {
  const unplayable = m2Problems(scenario);
  if (unplayable.length > 0) throw new Error(`${scenario.id} can't run in M2: ${unplayable[0]}`);
  // The cap first: it is what the owner approved, so it is checked before anything else.
  const callCap = options.callCap ?? scenario.budget.calls;
  if (!Number.isInteger(callCap) || callCap < 1 || callCap > scenario.budget.calls) {
    throw new Error(
      `The cap must be a whole number from 1 to ${scenario.id}'s budget of ${scenario.budget.calls}, not ${callCap}.`,
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
  const app = await launch({
    dataDir,
    port: 0,
    webRoot,
    provider: harness.provider,
    now,
    openBrowser: () => Promise.resolve(),
    ...(options.mode === "live"
      ? {}
      : {
          setup: {
            findClaude: () =>
              Promise.resolve({ ok: true as const, executable: "rehearsal", version: "0.0.0" }),
          },
        }),
  });
  if (app.status !== "started") throw new Error(`Tessera didn't start: ${app.status}`);
  const store = app.dataFolder;
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
    // Inside the guard, so a browser that won't start still stops Tessera and leaves a report.
    browser = await (options.launchBrowser ?? (() => chromium.launch({ channel: "chrome" })))();
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      timezoneId: scenario.clock.zone,
      locale: scenario.language,
      recordVideo: { dir: folder },
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
        });
        const after = readHostState(store, await openWorkspace(page));
        result.notice = cancelledNext ? "Sent; the next step cancels it." : await said(page, s);
        result.problems = cancelledNext ? [] : checkFacts(before, after, outcome, s.expect, target);
      } catch (error) {
        result.problems = [error instanceof Error ? error.message.split("\n")[0]! : String(error)];
        result.notice = await said(page, s).catch(() => "");
      }
      // Answers that didn't fit fail the step whatever the host showed (TEST-04).
      result.problems.push(...misfits().slice(misfitsBefore));
      result.outcome = result.problems.length === 0 ? "passed" : "failed";
      result.seconds = (Date.now() - began) / 1000;
      result.screenshot = await toolShown(page);
      await page.screenshot({ path: path.join(folder, `step-${result.index}.png`) });
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
  const tool = page
    .frameLocator(".tool-frame iframe")
    .frameLocator("iframe")
    .frameLocator("iframe");
  return tool
    .locator("body *:visible")
    .first()
    .waitFor({ timeout: 5_000 })
    .then(
      () => "tool" as const,
      () => "empty" as const,
    );
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
    await button(page, say("workspaces.save", { name: workspaceTitle(id) })).click();
    await page.getByLabel(say("workspaces.saveLabel")).fill(s.save);
    await button(page, say("workspaces.saveConfirm")).click();
    await page.getByText(say("workspaces.savedAs", { name: s.save })).waitFor();
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
      await button(page, say("nav.library")).click();
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
    const history = page.getByRole("region", { name: say("history.heading") });
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
    return { claim: "none" };
  }
  if ("switch" in s) {
    if (s.switch === "new") {
      // The host app has no control for an empty workspace yet (#132): it is made the way the app
      // would, through the store, then opened in the app like any other.
      createWorkspace(store, NEW_WORKSPACE);
      await page.reload();
      await button(page, say("workspaces.open", { name: NEW_WORKSPACE })).click();
    } else {
      await button(page, say("nav.workspaces")).click();
      await button(page, say("workspaces.open", { name: s.switch })).click();
    }
    await page.locator(".tool-panel[data-workspace-id]").waitFor();
    return { claim: "none" };
  }
  if ("delete" in s) {
    const match = listWorkspaces(store).filter((w) => w.title === s.delete);
    if (match.length !== 1) throw new Error(`${match.length} workspaces are named ${s.delete}.`);
    target.trashes = match[0]!.id;
    await button(page, say("nav.workspaces")).click();
    await button(page, say("workspaces.delete", { name: s.delete })).click();
    await page.getByText(say("workspaces.deleted", { name: s.delete })).waitFor();
    return { claim: "none" };
  }
  if ("restore" in s) {
    await button(page, say("nav.trash")).click();
    await button(page, say("trash.restoreLabel", { name: s.restore })).click();
    await page.getByText(say("trash.restored", { name: s.restore })).waitFor();
    return { claim: "none" };
  }
  if ("reload" in s || "next-day" in s) {
    if ("next-day" in s) await run.nextDay();
    // Whatever the app opens after a reload is what the facts check: the runner never reopens it.
    await page.reload();
    await requestBox(page).waitFor();
    return { claim: "none" };
  }
  throw new Error(`The ${stepKind(s)} step isn't played in M2.`);
}
