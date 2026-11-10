import type { Acceptance, AcceptanceCheck } from "@tessera/contracts";
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

/** The checks of one acceptance answer: the ones a request's stage wrote. */
export type AcceptanceChecks = Extract<Acceptance, { outcome: "checks" }>;

/** Text as a person compares it: spaces collapsed, capitals ignored. */
const loose = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

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

/** Runs one check on a fresh start of the candidate. */
async function runCheck(context: CheckContext, check: AcceptanceCheck): Promise<CheckOutcome> {
  const tool = await context.rehearse();
  const { expect } = check;
  const read: DriveStep = { do: "read", hook: expect.hook };
  // A count change compares with the count before the steps; the others look only after.
  const before = expect.see === "count-change" ? [read] : [];
  const steps: DriveStep[] = [...before, ...(check.steps as DriveStep[]), read];
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
  const shown = texts.some((text) => loose(text).includes(loose(expect.text)));
  if (expect.see === "shows") {
    return shown ? { ok: true } : broke(check, expectation(check), quoted(texts));
  }
  return shown ? broke(check, expectation(check), quoted(texts)) : { ok: true };
}

/**
 * The acceptance checks of one request (VER-09), run in staging after the smoke check, in order;
 * the first that fails ends them. Its name is `acceptance`, so the version's checks record it and
 * the person reads "checked against your request".
 */
export const acceptanceCheck = (acceptance: AcceptanceChecks): VerificationCheck => ({
  name: "acceptance",
  run: async (context) => {
    for (const check of acceptance.checks) {
      const outcome = await runCheck(context, check);
      if (!outcome.ok) return outcome;
    }
    return { ok: true };
  },
});
