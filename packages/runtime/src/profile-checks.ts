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
});

async function itemList(context: CheckContext): Promise<CheckOutcome> {
  const profile = PROFILES["item-list"];
  const name = profile.fixture.itemName;
  const [adds, removes, reopens] = profile.rules;
  const has = (texts: readonly string[]) => texts.some((text) => text.includes(name));

  // Adding: one more item, showing its name.
  const added = await drive("item-list", adds, await context.rehearse(), [
    { do: "read", hook: "item" },
    { do: "fill", hook: "item-name", value: name },
    { do: "click", hook: "item-add" },
    { do: "read", hook: "item" },
  ]);
  if (!("steps" in added)) return added;
  const before = seen(added.steps[0]).count;
  const after = seen(added.steps[3]);
  if (after.count !== before + 1) {
    return broke(
      "item-list",
      adds,
      `${before + 1} items after adding "${name}" to ${before}`,
      `${after.count}`,
    );
  }
  if (!has(after.texts)) {
    return broke(
      "item-list",
      adds,
      `an item showing "${name}"`,
      `items showing ${clip(after.texts)}`,
    );
  }

  // Opened again: the item it saved is still there.
  const kept = await drive("item-list", reopens, await context.rehearse(), [
    { do: "read", hook: "item" },
  ]);
  if (!("steps" in kept)) return kept;
  const reopened = seen(kept.steps[0]);
  if (reopened.count !== before + 1 || !has(reopened.texts)) {
    return broke(
      "item-list",
      reopens,
      `${before + 1} items, one showing "${name}", after opening the tool again`,
      `${reopened.count}, showing ${clip(reopened.texts)}`,
    );
  }

  // Removing: that item goes, and stays gone once opened again.
  const index = reopened.texts.findIndex((text) => text.includes(name));
  const removed = await drive("item-list", removes, await context.rehearse(), [
    { do: "click", hook: "item-remove", index },
    { do: "read", hook: "item" },
  ]);
  if (!("steps" in removed)) return removed;
  const left = seen(removed.steps[1]);
  if (left.count !== before || has(left.texts)) {
    return broke(
      "item-list",
      removes,
      `${before} items, none showing "${name}", after removing it`,
      `${left.count}, showing ${clip(left.texts)}`,
    );
  }
  const gone = await drive("item-list", reopens, await context.rehearse(), [
    { do: "read", hook: "item" },
  ]);
  if (!("steps" in gone)) return gone;
  const last = seen(gone.steps[0]);
  if (last.count !== before || has(last.texts)) {
    return broke(
      "item-list",
      reopens,
      `${before} items, none showing "${name}", after removing it and opening the tool again`,
      `${last.count}, showing ${clip(last.texts)}`,
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
