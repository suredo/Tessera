// Tests for the CI workflow (ENG-02, TEST-01): it runs on every change, and runs each check M0 set
// up. They read .github/workflows/ci.yml, so they show what CI is told to run, not that a run passed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; run?: string; uses?: string };
type Job = {
  "runs-on": string;
  strategy?: { matrix: { check: string[] } };
  steps: Step[];
};
type Workflow = {
  on: { pull_request: { types: string[] }; push: { branches: string[] } };
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const text = read(".github/workflows/ci.yml");
const workflow = parse(text) as Workflow;
const job = (name: string): Job => {
  const found = workflow.jobs[name];
  if (!found) throw new Error(`ci.yml has no job "${name}"`);
  return found;
};
const runs = (name: string) => job(name).steps.flatMap((s) => (s.run ? [s.run] : []));

describe("the CI workflow", () => {
  it("runs on every pull request and on every push to main (ENG-02)", () => {
    expect(workflow.on.pull_request.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened"]),
    );
    expect(workflow.on.push.branches).toEqual(["main"]);
  });

  it("runs every check M0 set up: the workspace's checks, the OKF check with drift, and merge-ready (ENG-02)", () => {
    expect(job("checks").strategy?.matrix.check).toEqual(
      expect.arrayContaining([
        "typecheck",
        "lint",
        "format:check",
        "test",
        "secrets",
        "build",
        "coverage",
      ]),
    );
    expect(runs("checks")).toContain("pnpm run ${{ matrix.check }}");
    expect(runs("okf")).toContain("node --test scripts/okf-check.test.mjs");
    expect(runs("okf").some((r) => r.includes("node scripts/okf-check.mjs --base"))).toBe(true);
    expect(runs("merge-ready")).toContain("node scripts/okf-check.mjs --merge-ready");
  });

  it("runs the fast checks on Linux and keeps one Windows job, which runs the checker's tests too (ENG-02)", () => {
    const windows = Object.entries(workflow.jobs).filter(
      ([, j]) => j["runs-on"] !== "ubuntu-latest",
    );
    expect(windows.map(([name, j]) => [name, j["runs-on"]])).toEqual([
      ["windows", "windows-latest"],
    ]);
    expect(runs("windows")).toContain("node --test scripts/okf-check.test.mjs");
  });

  it("runs the unit tests of every package and script on every change (TEST-01)", () => {
    expect(job("checks").strategy?.matrix.check).toContain("test");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test"]).toBe("vitest run");
    const vitest = read("vitest.config.ts");
    for (const pattern of ["packages/*/test/", "evals/test/", "scripts/test/"]) {
      expect(vitest).toContain(pattern);
    }
  });

  it("runs the browser tests in Chrome and Edge on Windows (TEST-06, RUN-06)", () => {
    expect(runs("windows")).toContain("pnpm e2e");
    const playwright = read("playwright.config.ts");
    expect(playwright).toContain('chrome: "chrome"');
    expect(playwright).toContain('edge: "msedge"');
  });

  it("gives no job a secret, such as a provider's key, and only read access (ENG-02)", () => {
    expect(text).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflow.permissions).toEqual({ contents: "read" });
  });
});
