import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeProvider, findClaude, type Provider } from "@tessera/server";
import type { RunMode } from "../../src/index.ts";

// What the M0 spikes need beyond the product's Claude Code adapter (#139): the dry run's provider,
// the live one after the free checks, the run mode from the command line and a run folder. The
// calls themselves go through the product adapter, with its locked flags and clean environment.

const here = path.dirname(fileURLToPath(import.meta.url));

/** The fake claude program the adapter's contract tests use, which never reaches a model. */
export const FAKE_CLAUDE = path.join(
  here,
  "..",
  "..",
  "..",
  "packages",
  "server",
  "test",
  "support",
  "fake-claude.ts",
);

/**
 * The dry run's provider: the product adapter, starting the fake claude instead of the real one.
 * The fake answers from `repliesFile` by call order and writes what it got to `callsFolder`.
 */
export const fakeClaudeProvider = (repliesFile: string, callsFolder: string): Provider =>
  createClaudeProvider({
    executable: process.execPath,
    leadingArgs: [FAKE_CLAUDE, repliesFile, callsFolder],
    live: false,
  });

/** The real CLI, after the free checks: found, at least the tested version, and signed in. */
export async function liveClaudeProvider(): Promise<{ provider: Provider; cliVersion: string }> {
  const found = await findClaude();
  // A missing sign-in or an old CLI stops here, before the harness counts a call (L-71).
  if (!found.ok) throw new Error(found.message);
  const provider = createClaudeProvider({ executable: found.executable, live: true });
  return { provider, cliVersion: found.version };
}

/** `--dry-run`, or `--live` with `--approved-cap` equal to the cap the owner approved (ENG-07). */
export function runModeFrom(argv: readonly string[], approvedCap: number): RunMode {
  const live = argv.includes("--live");
  if (live === argv.includes("--dry-run")) throw new Error("Pass either --dry-run or --live.");
  const capAt = argv.indexOf("--approved-cap");
  if (live && (capAt < 0 || Number(argv[capAt + 1]) !== approvedCap)) {
    throw new Error(`A live run needs --approved-cap ${approvedCap}, the cap the owner approved.`);
  }
  return live ? "live" : "dry-run";
}

/** A new folder for one run, under the ignored test-output folder (ENG-10, ENG-19). */
export const runFolder = (spike: string, mode: RunMode): string =>
  path.join(
    here,
    "..",
    "..",
    "..",
    "test-output",
    "evals",
    `${spike}-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
