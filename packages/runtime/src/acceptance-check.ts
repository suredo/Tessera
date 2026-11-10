import type { AcceptanceCheck, AcceptanceChecks } from "@tessera/contracts";
import {
  driveTool,
  type CheckContext,
  type CheckOutcome,
  type VerificationCheck,
} from "./checks.ts";
import type { DriveResult, DriveStep } from "./protocol.ts";

// The acceptance checks from the request (VER-09, A49, an M3 experiment): for a tool that fits no
// profile, the checks a separate stage wrote from the person's request run in staging after the
// smoke check, each on the candidate started again with its saves going to a throwaway copy
// (BRG-06), through the hooks the stage named and the generation prompt asked for. A check enforces
// only what it states. A failure says what was expected, what was observed, and that the rule is
// the request's (VER-07). A tool that passes is "checked against your request", which is weaker
// than a profile's behavior check.

const quoted = (texts: readonly string[]) =>
  texts.length === 0
    ? "nothing shown with that hook"
    : texts
        .slice(0, 5)
        .map((text) => `"${text.slice(0, 60)}"`)
        .join(", ") + (texts.length > 5 ? ` and ${texts.length - 5} more` : "");

/** A failure of a check from the request, as repair and the details view read it (VER-07). */
const broke = (check: AcceptanceCheck, expected: string, observed: string): CheckOutcome => ({
  ok: false,
  reason: `A check from your request (${check.says}): expected ${expected}; observed ${observed}.`,
});

/** What the check expects to see, in words. */
function expectation(check: AcceptanceCheck): string {
  const { expect } = check;
  if (expect.see === "shows") return `an element marked ${expect.hook} showing "${expect.text}"`;
  if (expect.see === "hides") return `no element marked ${expect.hook} showing "${expect.text}"`;
  const sign = expect.changeCount > 0 ? "+" : "";
  return `the elements marked ${expect.hook} to change in number by ${sign}${expect.changeCount}`;
}

/**
 * Runs one check on a start of the candidate. A text is looked for in every element the hook
 * marks that the page shows, in its whole text, capitals and repeated spaces aside (a loose find);
 * the read beside it only says what was shown when the check fails.
 */
async function runCheck(context: CheckContext, check: AcceptanceCheck): Promise<CheckOutcome> {
  const tool = await context.rehearse();
  const { expect } = check;
  const read: DriveStep = { do: "read", hook: expect.hook };
  const look: DriveStep[] =
    expect.see === "count-change"
      ? [read]
      : [{ do: "find", hook: expect.hook, value: expect.text, loose: true }, read];
  // A count change compares with the count before the steps; the others look only after.
  const before = expect.see === "count-change" ? [read] : [];
  const steps: DriveStep[] = [...before, ...(check.steps as DriveStep[]), ...look];
  const report = await driveTool(tool, steps);
  if (!report) return { ok: false, reason: "The tool's answer to the check couldn't be read." };
  const failed = report.steps.find((step) => !step.ok);
  if (failed && !failed.ok) {
    return broke(
      check,
      "the elements its hooks name, as the request's checks asked",
      failed.problem,
    );
  }
  if (report.steps.length < steps.length) {
    return { ok: false, reason: "The tool's answer to the check couldn't be read." };
  }
  if (report.problems.length > 0) return broke(check, "no errors", report.problems.join(" "));
  const last = report.steps.at(-1) as Extract<DriveResult, { ok: true }>;
  const texts = last.texts ?? [];
  if (expect.see === "count-change") {
    const first = report.steps[0] as Extract<DriveResult, { ok: true }>;
    const change = (last.count ?? 0) - (first.count ?? 0);
    return change === expect.changeCount
      ? { ok: true }
      : broke(
          check,
          expectation(check),
          `${first.count ?? 0} before and ${last.count ?? 0} after, a change of ${change}`,
        );
  }
  const found = report.steps.at(-2) as Extract<DriveResult, { ok: true }>;
  const shown = (found.matches ?? []).length > 0;
  const observed =
    expect.see === "hides" && shown
      ? `it shown in the element at position ${found.matches![0]! + 1} of ${found.count ?? 0}`
      : quoted(texts);
  if (expect.see === "shows") {
    return shown ? { ok: true } : broke(check, expectation(check), observed);
  }
  return shown ? broke(check, expectation(check), observed) : { ok: true };
}

/**
 * The acceptance checks of one request (VER-09), one staging check each, run in order after the
 * smoke check, so each starts on a fresh throwaway copy of the synthetic data and none depends on
 * what another saved; the first that fails ends staging. Each is named `acceptance`, so the
 * version's checks record it and the person reads "checked against your request".
 */
export const acceptanceChecks = (acceptance: AcceptanceChecks): VerificationCheck[] =>
  acceptance.checks.map((check) => ({
    name: "acceptance",
    run: (context) => runCheck(context, check),
  }));
