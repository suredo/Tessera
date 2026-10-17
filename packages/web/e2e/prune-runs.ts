import fs from "node:fs";
import path from "node:path";

// Keeps the last few local Playwright runs in test-output/playwright/ and deletes older ones, so
// videos don't pile up (ENG-10). Run folders are named by start time, so names sort by age.
const KEEP = 3;

export default function pruneRuns(): void {
  // The repository root, where playwright.config.ts puts the runs, whatever folder Playwright ran in.
  const dir = path.resolve(import.meta.dirname, "..", "..", "..", "test-output", "playwright");
  if (!fs.existsSync(dir)) return;
  const current = process.env["TESSERA_E2E_RUN"];
  const older = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== current)
    .map((entry) => entry.name)
    .sort();
  // With this run, KEEP runs remain.
  for (const old of older.slice(0, Math.max(0, older.length - (KEEP - 1)))) {
    fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  }
}
