import { defineConfig } from "vitest/config";

// Unit tests for every package (TEST-01), run from the repository root.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "evals/test/**/*.test.ts"],
  },
});
