import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { ClaudeCheck } from "../../contracts/src/index.ts";
import type { ProcessResult } from "../../server/src/platform/index.ts";
import {
  createClaudeProvider,
  FAILURE_MESSAGES,
  findClaude,
} from "../../server/src/providers/index.ts";
import { en } from "../src/i18n/en.ts";
import { startApp, testTool, workspaceWith, type AppHost } from "./support/app-host.ts";

// The setup check and the status screen (PLAT-03, APP-07, CLI-02): each state of Claude Code, found
// by the real check against a faked CLI, is explained in plain words with its fix, on the first
// screen, the main screen and the status screen; the probe is offered only once the check passes,
// says it costs a call, and calls the fake claude program, never a model (ENG-11). In Chrome and
// Edge at 320 and 1280 px (TEST-06), against a real Tessera of its own on a temporary data folder
// (ENG-19). The tests run in order and change the faked state as they go.

const fake = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "server",
  "test",
  "support",
  "fake-claude.ts",
);
const temps: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-status-e2e-"));
  temps.push(dir);
  return dir;
};
/** A PATH folder with a `claude` program file, its extension spelled as PATHEXT spells it. */
const pathWith = (file: string) => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, file), "");
  return { PATH: dir, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
};
/** The CLI answering `--version` and `auth status` as given, without starting a program. */
const answering =
  (version: string, auth: string) =>
  (_exe: string, args: readonly string[]): Promise<ProcessResult> =>
    Promise.resolve({
      exitCode: 0,
      stdout: args[0] === "--version" ? version : auth,
      stderr: "",
      timedOut: false,
      cancelled: false,
    });
const SIGNED_IN = '{"loggedIn":true}';

// Each state of Claude Code, as the real check finds it on Windows against a faked CLI; each
// state's folder is made once, so the paths it names stay the same.
const nothing = { PATH: tempDir() };
const batchFile = pathWith("claude.CMD");
const program = pathWith("claude.exe");
const STATES: Record<string, () => Promise<ClaudeCheck>> = {
  missing: () => findClaude(nothing, "win32"),
  "batch-file": () => findClaude(batchFile, "win32"),
  old: () => findClaude(program, "win32", answering("2.1.100", SIGNED_IN)),
  "signed-out": () => findClaude(program, "win32", answering("2.1.310", '{"loggedIn":false}')),
  broken: () => findClaude(program, "win32", () => Promise.reject(new Error("spawn EACCES"))),
  ready: () => findClaude(program, "win32", answering("2.1.310", SIGNED_IN)),
};
let state = "ready";

const usage = {
  input_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 1,
};
let calls = "";
let app: AppHost;
test.beforeAll(async () => {
  const dir = tempDir();
  const replies = path.join(dir, "replies.json");
  calls = path.join(dir, "calls");
  fs.writeFileSync(
    replies,
    JSON.stringify([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1200,
        structured_output: { answer: { connected: true } },
        usage,
      },
      {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
        usage,
      },
    ]),
  );
  app = await startApp({
    findClaude: () => STATES[state]!(),
    probeProvider: () =>
      createClaudeProvider({
        executable: process.execPath,
        leadingArgs: [fake, replies, calls],
        live: false,
      }),
  });
});
test.afterAll(async () => {
  await app.close();
  temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const probesMade = () => (fs.existsSync(calls) ? fs.readdirSync(calls).length : 0);
const status = (page: Page) => page.getByRole("region", { name: en["setup.heading"] });
const probeButton = (page: Page) => page.getByRole("button", { name: en["setup.probe.run"] });

async function violations(page: Page): Promise<string[]> {
  const { violations: found } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".tool-frame")
    .analyze();
  return found.flatMap((rule) =>
    rule.nodes.map((node) => `${rule.id} (${rule.impact}): ${node.target.join(" ")}`),
  );
}

test("PLAT-03: on the first screen, each Claude Code problem is explained with its fix, and the status screen says the same", async ({
  page,
}) => {
  for (const problem of ["missing", "batch-file", "old", "signed-out", "broken"]) {
    state = problem;
    const expected = await STATES[problem]!();
    expect(expected.ok).toBe(false);
    const message = expected.ok ? "" : expected.message;
    await page.goto(app.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["home.heading"]);
    await expect(page.getByRole("alert")).toContainText(`Tessera can't make tools yet. ${message}`);
    await page.getByRole("button", { name: en["setup.openStatus"] }).click();
    await expect(status(page).getByText(message, { exact: true })).toBeVisible();
    // Nothing that needs the model is offered until the check passes.
    await expect(probeButton(page)).toHaveCount(0);
    await expect(status(page).getByText(en["setup.probe.waits"])).toBeVisible();
    expect(await violations(page)).toEqual([]);
  }
  expect(probesMade()).toBe(0);
});

test("APP-07: the status screen shows Claude Code, Node.js and the data folder, and checking again shows a fix at once", async ({
  page,
}) => {
  state = "signed-out";
  await page.goto(app.url);
  await page.getByRole("button", { name: en["setup.openStatus"] }).click();
  await expect(status(page).getByText(FAILURE_MESSAGES.sign_in)).toBeVisible();
  state = "ready";
  await status(page).getByRole("button", { name: en["setup.recheck"] }).click();
  const ready = (await STATES["ready"]!()) as Extract<ClaudeCheck, { ok: true }>;
  await expect(
    status(page).getByText(`Claude Code 2.1.310 is ready, at ${ready.executable}.`),
  ).toBeVisible();
  await expect(status(page).getByText(`Node.js ${process.versions.node} is ready.`)).toBeVisible();
  await expect(
    status(page).getByText(new RegExp(`^Your work is kept in .+, which holds \\d`)),
  ).toBeVisible();
  await expect(status(page).getByText(app.dataDir, { exact: false })).toBeVisible();
  await expect(probeButton(page)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("PLAT-03: the main screen says what is wrong and reaches the status screen; once ready, it says nothing", async ({
  page,
}) => {
  workspaceWith(app.folder, "Errands", testTool("Errands"));
  state = "old";
  await page.goto(app.url);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("older than");
  await alert.getByRole("button", { name: en["setup.openStatus"] }).click();
  await expect(status(page)).toBeVisible();
  await expect(page.getByRole("button", { name: en["nav.status"] })).toHaveAttribute(
    "aria-current",
    "page",
  );
  state = "ready";
  await page.goto(app.url);
  await expect(page.getByRole("button", { name: "Move Errands to the trash" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("CLI-02: the probe says it costs a call, runs only when asked, and says how it went in plain words", async ({
  page,
}) => {
  state = "ready";
  await page.goto(app.url);
  await page.getByRole("button", { name: en["nav.status"] }).click();
  await expect(status(page).getByText(en["setup.probe.intro"])).toBeVisible();
  expect(probesMade()).toBe(0);
  await probeButton(page).click();
  await expect(
    status(page).getByText("The model answered in 1.2 seconds (claude-haiku-5-5)."),
  ).toBeVisible();
  expect(probesMade()).toBe(1);
  await probeButton(page).click();
  await expect(
    status(page).getByText(`The probe didn't work. ${FAILURE_MESSAGES.sign_in}`),
  ).toBeVisible();
  expect(probesMade()).toBe(2);
});

test("PLAT-03: a Node.js older than Tessera needs is explained with its fix", async ({ page }) => {
  const old = await startApp({
    findClaude: STATES["ready"]!,
    nodeVersion: "20.11.0",
  });
  try {
    await page.goto(old.url);
    await expect(page.getByRole("alert")).toContainText(
      "Tessera needs Node.js 22.12.0 or later, and this computer has 20.11.0. Install Node.js 22 from nodejs.org, then start Tessera again.",
    );
    await page.getByRole("button", { name: en["setup.openStatus"] }).click();
    await expect(probeButton(page)).toHaveCount(0);
  } finally {
    await old.close();
  }
});

test("PLAT-03: a check that couldn't be made says so, never looks endless, and can be tried again", async ({
  page,
}) => {
  state = "ready";
  let failures = 1;
  await page.route("**/api/setup", (route) =>
    failures-- > 0 ? route.fulfill({ status: 500, body: "" }) : route.continue(),
  );
  await page.goto(app.url);
  await expect(page.getByRole("alert")).toContainText(
    `Tessera can't make tools yet. ${en["setup.unreadable"]}`,
  );
  await page.getByRole("alert").getByRole("button", { name: en["setup.openStatus"] }).click();
  await expect(status(page).getByText(en["setup.unreadable"])).toBeVisible();
  await expect(status(page).getByText(en["setup.checking"])).toHaveCount(0);
  await expect(probeButton(page)).toHaveCount(0);
  await status(page).getByRole("button", { name: en["setup.recheck"] }).click();
  await expect(status(page).getByText(/^Claude Code 2\.1\.310 is ready/)).toBeVisible();
  await expect(status(page).getByText(en["setup.unreadable"])).toHaveCount(0);
  await expect(probeButton(page)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
