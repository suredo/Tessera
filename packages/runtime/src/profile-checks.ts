import { PROFILES, type ProfileId } from "@tessera/contracts";
import {
  driveTool,
  type CheckContext,
  type CheckOutcome,
  type DriveReport,
  type VerificationCheck,
} from "./checks.ts";
import type { MountedTool } from "./host.ts";
import type { DriveResult, DriveStep } from "./protocol.ts";

// The verification profiles' behavior checks (VER-03): each drives a candidate that fits its
// profile through the hooks the profile names, in rehearsals whose saves go to a throwaway copy
// (BRG-06), and checks only the rules the profile states, which its prompt part gave the tool
// (VER-04). A failure says what was expected, what was observed and whose rule it is (VER-07).

const clip = (texts: readonly string[]) =>
  texts.length === 0 ? "none" : texts.map((text) => `"${text.slice(0, 60)}"`).join(", ");

/** A failure of a profile's rule, as repair and the details view read it (VER-07). */
const broke = (profile: ProfileId, rule: string, expected: string, observed: string) =>
  ({
    ok: false,
    reason: `The ${profile} check, a rule of Tessera's (${rule}): expected ${expected}; observed ${observed}.`,
  }) as const;

/** Drives `tool` and gives each step's result, or a failure saying what couldn't be done. */
async function drive(
  profile: ProfileId,
  rule: string,
  tool: MountedTool,
  steps: readonly DriveStep[],
): Promise<{ steps: DriveResult[] } | CheckOutcome> {
  const report: DriveReport | undefined = await driveTool(tool, steps);
  if (!report) return { ok: false, reason: "The tool's answer to the check couldn't be read." };
  const failed = report.steps.find((step) => !step.ok);
  if (failed && !failed.ok) {
    return broke(profile, rule, "the elements its hooks name, as the prompt asked", failed.problem);
  }
  if (report.steps.length < steps.length) {
    return { ok: false, reason: "The tool's answer to the check couldn't be read." };
  }
  if (report.problems.length > 0) {
    return broke(profile, rule, "no errors", report.problems.join(" "));
  }
  return { steps: report.steps };
}

/** What a read step saw: how many elements, and their text. */
const seen = (result: DriveResult | undefined) => ({
  count: result?.ok ? (result.count ?? 0) : 0,
  texts: result?.ok ? (result.texts ?? []) : [],
  matches: result?.ok ? (result.matches ?? []) : [],
});

/** "1 item", "3 items". */
const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

/** Whether two lists show the same texts, in any order, each as often. */
function sameTexts(one: readonly string[], other: readonly string[]): boolean {
  const sorted = (texts: readonly string[]) => JSON.stringify([...texts].sort());
  return one.length === other.length && sorted(one) === sorted(other);
}

/** The most items a read reports the text of; a longer list's texts aren't all seen. */
const READ_WINDOW = 100;

async function itemList(context: CheckContext): Promise<CheckOutcome> {
  const profile = PROFILES["item-list"];
  const [adds, removes, reopens] = profile.rules;
  // A name no starting item shows, so the item found is the one the check added.
  const token = Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const name = `${profile.fixture.itemName} ${token}`;

  // Adding: one more item, and exactly one showing its name.
  const added = await drive("item-list", adds, await context.rehearse(), [
    { do: "read", hook: "item" },
    { do: "fill", hook: "item-name", value: name },
    { do: "click", hook: "item-add" },
    { do: "read", hook: "item" },
    { do: "find", hook: "item", value: name },
  ]);
  if (!("steps" in added)) return added;
  const before = seen(added.steps[0]);
  const after = seen(added.steps[3]);
  // The starting items' texts, when the read saw all of them.
  const complete = before.count <= READ_WINDOW;
  if (after.count !== before.count + 1) {
    return broke(
      "item-list",
      adds,
      `${items(before.count + 1)} after adding "${name}" to ${before.count}`,
      `${after.count}`,
    );
  }
  const found = seen(added.steps[4]).matches;
  if (found.length !== 1) {
    return broke(
      "item-list",
      adds,
      `one item showing "${name}"`,
      `${items(found.length)} showing it, of ${after.count}`,
    );
  }

  // Opened again: the list is as it was saved.
  const kept = await drive("item-list", reopens, await context.rehearse(), [
    { do: "read", hook: "item" },
    { do: "find", hook: "item", value: name },
  ]);
  if (!("steps" in kept)) return kept;
  const reopened = seen(kept.steps[0]);
  const keptAt = seen(kept.steps[1]).matches;
  if (
    reopened.count !== after.count ||
    keptAt.length !== 1 ||
    (after.count <= READ_WINDOW && !sameTexts(reopened.texts, after.texts))
  ) {
    return broke(
      "item-list",
      reopens,
      `the ${items(after.count)} it showed, one showing "${name}", after opening the tool again`,
      `${items(reopened.count)}, showing ${clip(reopened.texts)}`,
    );
  }

  // Removing: that item goes, the others stay as they started, and so once opened again.
  const removed = await drive("item-list", removes, await context.rehearse(), [
    { do: "click", hook: "item-remove", index: keptAt[0] },
    { do: "read", hook: "item" },
    { do: "find", hook: "item", value: name },
  ]);
  if (!("steps" in removed)) return removed;
  const left = seen(removed.steps[1]);
  if (left.count !== before.count || seen(removed.steps[2]).matches.length > 0) {
    return broke(
      "item-list",
      removes,
      `${items(before.count)}, none showing "${name}", after removing it`,
      `${items(left.count)}, showing ${clip(left.texts)}`,
    );
  }
  const gone = await drive("item-list", reopens, await context.rehearse(), [
    { do: "read", hook: "item" },
    { do: "find", hook: "item", value: name },
  ]);
  if (!("steps" in gone)) return gone;
  const last = seen(gone.steps[0]);
  if (
    last.count !== before.count ||
    seen(gone.steps[1]).matches.length > 0 ||
    (complete && !sameTexts(last.texts, before.texts))
  ) {
    return broke(
      "item-list",
      reopens,
      `the ${items(before.count)} it started with, as they were, after removing "${name}" and opening the tool again`,
      `${items(last.count)}, showing ${clip(last.texts)}`,
    );
  }
  return { ok: true };
}

const CHECKS: Readonly<Record<ProfileId, (context: CheckContext) => Promise<CheckOutcome>>> = {
  "item-list": itemList,
};

/**
 * The behavior check of the profile `id` (VER-03), run in staging after the smoke check. Its name
 * is `behavior`, so a failure is repaired as one (GEN-09).
 */
export const profileCheck = (id: ProfileId): VerificationCheck => ({
  name: "behavior",
  run: (context) => CHECKS[id](context),
});
