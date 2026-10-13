import { defineConfig } from "vitest/config";

// Unit tests for every package (TEST-01) and the repository scripts, run from the repository root.
export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.{ts,tsx}",
      "evals/test/**/*.test.ts",
      "scripts/test/**/*.test.mjs",
    ],
  },
});
