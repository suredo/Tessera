// Docs: docs/code/evals/runner.md
import { en } from "../../../packages/web/src/i18n/en.ts";
import type { StepOutcome } from "../scenarios/index.ts";

// What the host app said after a step, read from its notice in the app's own words (en.ts), so a
// change to a message changes what the runner recognizes with it. The facts check a claim against
// what was stored (GEN-08); this only says what was claimed.

type Key = keyof typeof en;

/**
 * A message as a pattern: its fixed words exactly, each `{value}` as any text. A line break, which
 * keeps the model's words apart from the app's (GEN-12), may be read back as any whitespace.
 */
const pattern = (key: Key) =>
  new RegExp(
    en[key]
      .split(/\{\w+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
      .join("[\\s\\S]*"),
  );

const CLAIMS: readonly [Key, StepOutcome["claim"]][] = [
  ["request.made", "created"],
  ["request.edited", "changed"],
  ["request.dataChanged", "changed"],
  ["request.dataChangedOne", "changed"],
];
const ANSWERS: readonly [Key, NonNullable<StepOutcome["answer"]>][] = [
  ["request.clarify", "clarify"],
  ["request.unsupported", "unsupported"],
  ["request.stopped", "stopped"],
];

/** What a notice claims the host did, and the answer it gave instead of a tool, if any. */
export function outcomeOf(notice: string): Pick<StepOutcome, "claim" | "answer"> {
  const claim = CLAIMS.find(([key]) => pattern(key).test(notice))?.[1] ?? "none";
  // A request the server stopped mid-stage says so through the failure message, with the
  // server's own words (generation/routes.ts), as the app's cancel tests accept too.
  const stoppedOnServer = notice === say("request.failed", { message: "The request was stopped." });
  const answer =
    ANSWERS.find(([key]) => pattern(key).test(notice))?.[1] ??
    (stoppedOnServer ? "stopped" : undefined);
  return answer ? { claim, answer } : { claim };
}

/**
 * Each feature a big tool's reply says wasn't added, or may have been (GEN-17): its core standing
 * doesn't make the request a pass, so the step fails with these, in the app's own words.
 */
export function featuresMissed(notice: string): string[] {
  return (["request.followUpNotAdded", "request.followUpUncertain"] as const).flatMap((key) => {
    const [before] = en[key].split("{message}");
    const marker = before!.replace("{feature}", "");
    return notice.includes(marker)
      ? [
          `A feature${marker.trimEnd().replace(/:$/, "")}, so not every feature asked for is in place.`,
        ]
      : [];
  });
}

/** The app's words for a key, with its values filled, as a person reads them. */
export const say = (key: Key, values: Record<string, string> = {}): string =>
  en[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
