/// <reference types="node" />
import { defineConfig } from "@playwright/test";

// Browser tests (TEST-06): the installed Chrome, every spec at 1280 px and the layout specs at 320
// px too, each viewport set when the browser context is created (ENG-14). Edge waits for later
// (A56). No test records a video, on CI or locally, unless asked: TESSERA_E2E_RECORD=1 records
// every test's video, as a failure is looked into on the owner's machine (ENG-10). On CI a failed
// test keeps a light trace, its actions and console, to tell a stalled page from a slow browser
// (#83, #98); locally nothing is traced unless asked, to keep the owner's shared machine free
// (ENG-31), and `--trace on` traces a single run. Snapshots stay off: Playwright takes them inside
// every frame, which counts as the person's activation there and lets a tool write before any
// click (GEN-06). Without them it records no network either.
// Each worker loads this file again, so the run's folder name is chosen once and passed down.
process.env["TESSERA_E2E_RUN"] ??= new Date().toISOString().replace(/[:.]/g, "-");
const runFolder = `test-output/playwright/${process.env["TESSERA_E2E_RUN"]}`;
const record = process.env["TESSERA_E2E_RECORD"] === "1";
const traceFailures = !!process.env["CI"] || record;

/**
 * The specs whose checks depend on the window's width, which also run at 320 px (A56): the first
 * screen and the main screen must not scroll sideways, and the accessibility checks cover reflow.
 * `chat-layout.spec.ts` sets its own 1280 and 320 px viewports, so it needs only the one project.
 * A spec that checks how something is laid out on a narrow screen joins this list.
 */
const LAYOUT_SPECS = ["shell.spec.ts", "app.spec.ts", "a11y.spec.ts"];

export default defineConfig({
  testDir: "packages/web/e2e",
  outputDir: runFolder,
  globalSetup: ["./packages/web/e2e/prune-runs.ts", "./packages/web/e2e/warm-chrome.ts"],
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    video: record ? "on" : "off",
    trace: traceFailures
      ? { mode: "retain-on-failure", screenshots: false, snapshots: false, sources: false }
      : "off",
  },
  projects: [
    { name: "chrome-1280", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "chrome-320",
      testMatch: LAYOUT_SPECS,
      use: { viewport: { width: 320, height: 640 } },
    },
  ],
  webServer: {
    command:
      "vite build packages/web && vite preview packages/web --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
