// Docs: docs/code/evals/scenarios.md
import { createHash } from "node:crypto";
import { canonicalJson } from "@tessera/contracts";
import { listSavedTools, listWorkspaces, type Store } from "@tessera/server";
import type { Expectation } from "./scenario.ts";

// Automatic host facts (EVAL-02): after each step the runner reads what Tessera stored and checks
// it against what the step expects, and against what every step must keep: nothing unrelated
// changed, and no success claimed that the host didn't apply (GEN-08). No model is asked.

/** One workspace as the facts see it: its tool version and a hash of its data. */
export type WorkspaceFacts = {
  id: string;
  title: string;
  version: string | null;
  dataHash: string;
};

/** What Tessera has stored at one moment, and which workspace is open. */
export type HostState = {
  workspaces: WorkspaceFacts[];
  savedTools: { id: string; name: string; workspaceId: string }[];
  open: string | null;
};

/** What the host app showed after a step, as the runner read it. */
export type StepOutcome = {
  /** The saved tool offered to open, by ID (GEN-18). */
  offered?: string;
  /** What the host said it did; `none` when it said nothing changed or answered instead. */
  claim: "created" | "changed" | "none";
  /** An answer instead of a tool: clarify, unsupported, or a stop after Cancel. */
  answer?: "clarify" | "unsupported" | "stopped";
};

const hash = (value: unknown) =>
  createHash("sha256")
    .update(canonicalJson(value ?? null))
    .digest("hex");

/** Reads what Tessera has stored, with the workspace the host app has open. */
export function readHostState(store: Store, open: string | null): HostState {
  return {
    workspaces: listWorkspaces(store).map((w) => ({
      id: w.id,
      title: w.title,
      version: w.currentVersion,
      dataHash: hash(w.data),
    })),
    savedTools: listSavedTools(store).map(({ id, name, workspaceId }) => ({
      id,
      name,
      workspaceId,
    })),
    open,
  };
}

/**
 * Every way the step's outcome differs from what it expects, and from what every step must keep,
 * in plain words; none when it passed.
 */
export function checkFacts(
  before: HostState,
  after: HostState,
  outcome: StepOutcome,
  expected: Expectation = {},
): string[] {
  const problems: string[] = [];
  const earlier = new Map(before.workspaces.map((w) => [w.id, w]));
  const made = after.workspaces.filter((w) => !earlier.has(w.id) && w.version !== null);
  const was = before.open === null ? undefined : earlier.get(before.open);
  const now = after.workspaces.find((w) => w.id === after.open);
  // The same workspace's own changes; a step that opens another one changes neither.
  const sameOpen = was !== undefined && now !== undefined && was.id === now.id;
  const versionChanged = sameOpen && was.version !== now.version;
  const dataChanged = sameOpen && was.dataHash !== now.dataHash;

  if (expected.created !== undefined && expected.created !== made.length > 0) {
    problems.push(
      expected.created ? "No tool was created." : `A tool was created: ${made[0]!.title}.`,
    );
  }
  if (expected.version === "new" && !versionChanged) problems.push("The tool didn't change.");
  if (expected.version === "unchanged" && versionChanged) problems.push("The tool changed.");
  if (expected.data === "changed" && !dataChanged) problems.push("The data didn't change.");
  if (expected.data === "unchanged" && dataChanged) problems.push("The data changed.");
  if (expected.workspace === "new" && (now === undefined || earlier.has(now.id))) {
    problems.push("No new workspace is open.");
  }
  if (expected.workspace === "same" && !sameOpen) {
    problems.push("A different workspace is open.");
  }
  if (expected.workspace === "original") {
    const linked = new Set(after.savedTools.map((t) => t.workspaceId));
    if (now === undefined || !earlier.has(now.id) || !linked.has(now.id)) {
      problems.push("The saved tool's own workspace isn't open.");
    }
  }
  if (expected.offered === "saved" && outcome.offered === undefined) {
    problems.push("No saved tool was offered.");
  }
  if (expected.offered === undefined && outcome.offered !== undefined) {
    problems.push("A saved tool was offered when none was expected.");
  }
  if (expected.savedTool !== undefined) {
    const offered = after.savedTools.find((t) => t.id === outcome.offered);
    if (offered?.name !== expected.savedTool) {
      problems.push(
        `${expected.savedTool} wasn't offered${offered ? `; ${offered.name} was` : ""}.`,
      );
    }
  }
  if (expected.answer !== undefined && outcome.answer !== expected.answer) {
    problems.push(`The host didn't answer ${expected.answer}.`);
  }

  // Every step: nothing unrelated changed, and nothing claimed that didn't happen (GEN-08).
  for (const w of after.workspaces) {
    const old = earlier.get(w.id);
    if (!old || w.id === after.open || w.id === before.open) continue;
    if (old.version !== w.version || old.dataHash !== w.dataHash) {
      problems.push(`${w.title} changed, though the step wasn't about it.`);
    }
  }
  if (outcome.claim === "created" && made.length === 0) {
    problems.push("The host said a tool was made, but none was stored.");
  }
  if (outcome.claim === "changed" && !versionChanged && !dataChanged) {
    problems.push("The host said the tool changed, but nothing stored changed.");
  }
  return problems;
}
