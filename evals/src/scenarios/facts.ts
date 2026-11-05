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

/**
 * What a step acts on, by name, when it names something: the saved tool a Continue or Use again
 * opens, and the workspace a delete moves to the trash.
 */
export type StepTarget = { savedTool?: string; trashes?: string };

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
  target: StepTarget = {},
): string[] {
  const problems: string[] = [];
  const earlier = new Map(before.workspaces.map((w) => [w.id, w]));
  const later = new Map(after.workspaces.map((w) => [w.id, w]));
  // A tool is made when a workspace gains one: a new workspace, or an empty one that was open,
  // which a creation takes over (GEN-01).
  const made = after.workspaces.filter((w) => w.version !== null && !earlier.get(w.id)?.version);
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
    // The workspace the named saved tool's Continue opened before the step (DATA-07).
    const entry = before.savedTools.find((t) => t.name === target.savedTool);
    if (!entry)
      problems.push(`There was no saved tool named ${target.savedTool ?? "(none named)"}.`);
    else if (now?.id !== entry.workspaceId)
      problems.push("The saved tool's own workspace isn't open.");
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

  // Every step: nothing unrelated changed or went away, no saved tool's Continue moved, and
  // nothing claimed that didn't happen (GEN-08, DATA-07).
  for (const old of before.workspaces) {
    const w = later.get(old.id);
    if (!w) {
      if (old.title !== target.trashes)
        problems.push(`${old.title} is gone, though the step wasn't about it.`);
      continue;
    }
    if (w.id === after.open || w.id === before.open) continue;
    if (old.version !== w.version || old.dataHash !== w.dataHash) {
      problems.push(`${w.title} changed, though the step wasn't about it.`);
    }
  }
  const trashed = new Set(
    before.workspaces.filter((w) => w.title === target.trashes).map((w) => w.id),
  );
  for (const entry of before.savedTools) {
    const still = after.savedTools.find((t) => t.id === entry.id);
    if (!still) {
      // A saved tool goes to the trash with its workspace (DATA-09), and only then.
      if (!trashed.has(entry.workspaceId)) problems.push(`The saved tool ${entry.name} is gone.`);
    } else if (still.workspaceId !== entry.workspaceId) {
      problems.push(`${entry.name}'s Continue now opens a different workspace.`);
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
