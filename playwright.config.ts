/// <reference types="node" />
import { defineConfig } from "@playwright/test";

// Browser tests (TEST-06): the installed Chrome and Edge, at fixed viewports including 320 px,
// set when each browser context is created (ENG-14). Every test records a video (ENG-10), and a
// failed one keeps a light trace, its actions, console and network without screenshots or
// snapshots, to tell a stalled page from a slow browser (#83, #98).
// Each worker loads this file again, so the run's folder name is chosen once and passed down.
process.env["TESSERA_E2E_RUN"] ??= new Date().toISOString().replace(/[:.]/g, "-");
const runFolder = `test-output/playwright/${process.env["TESSERA_E2E_RUN"]}`;
const viewports = { "320": { width: 320, height: 640 }, "1280": { width: 1280, height: 800 } };
const browsers = { chrome: "chrome", edge: "msedge" };

export default defineConfig({
  testDir: "packages/web/e2e",
  outputDir: runFolder,
  globalSetup: "./packages/web/e2e/prune-runs.ts",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    video: "on",
    trace: { mode: "retain-on-failure", screenshots: false, snapshots: false, sources: false },
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
