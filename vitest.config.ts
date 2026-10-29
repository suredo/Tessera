import { defineConfig } from "vitest/config";

// Unit tests for every package (TEST-01) and the repository scripts, run from the repository root.
export default defineConfig({
  test: {
    // Bound subprocess and filesystem contention on local Windows checks (ENG-20, #188).
    maxWorkers: 4,
    // Many tests open a data folder (SQLite, migrations, a backup) and write to it. They take well
    // under a second alone, but several seconds while all the files run at once on Windows, and
    // past vitest's 5 s default in about one full run in three on a 12-core machine (ENG-20). None
    // asserts how long it takes, so every test gets 20 s; a test that needs more sets its own.
    testTimeout: 20_000,
    include: [
      "packages/*/test/**/*.test.{ts,tsx}",
      "evals/test/**/*.test.ts",
      "scripts/test/**/*.test.{mjs,ts}",
    ],
  },
});
