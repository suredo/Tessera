/// <reference types="node" />
import { defineConfig } from "@playwright/test";

// Browser tests (TEST-06): the installed Chrome and Edge, at fixed viewports including 320 px,
// set when each browser context is created (ENG-14). On CI every test records a video (ENG-10);
// locally only a failed test keeps its video, so runs don't fill the disk with passing tests' videos.
// Playwright still records every test and drops a passing one's video at the end, so the local
// runs' load is cut by running fewer specs, projects and workers (ENG-31). A failed test also
// keeps a light trace, its actions and console, to tell a stalled page from a slow
// browser (#83, #98). Snapshots stay off: Playwright takes them inside every frame, which counts as
// the person's activation there and lets a tool write before any click (GEN-06). Without them it
// records no network either.
// Each worker loads this file again, so the run's folder name is chosen once and passed down.
process.env["TESSERA_E2E_RUN"] ??= new Date().toISOString().replace(/[:.]/g, "-");
const runFolder = `test-output/playwright/${process.env["TESSERA_E2E_RUN"]}`;
const viewports = { "320": { width: 320, height: 640 }, "1280": { width: 1280, height: 800 } };
const browsers = { chrome: "chrome", edge: "msedge" };

export default defineConfig({
  testDir: "packages/web/e2e",
  outputDir: runFolder,
  globalSetup: ["./packages/web/e2e/prune-runs.ts", "./packages/web/e2e/warm-edge.ts"],
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // CI keeps every test's video and a trace of each failure (ENG-10). Locally nothing is recorded,
    // to keep the owner's machine free: rerun a failing spec with --video on or --trace on to see it.
    video: process.env["CI"] ? "on" : "off",
    trace: process.env["CI"]
      ? { mode: "retain-on-failure", screenshots: false, snapshots: false, sources: false }
      : "off",
  },
  projects: Object.entries(browsers).flatMap(([browser, channel]) =>
    Object.entries(viewports).map(([width, viewport]) => ({
      name: `${browser}-${width}`,
      use: { channel, viewport },
    })),
  ),
  webServer: {
    command:
      "vite build packages/web && vite preview packages/web --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
