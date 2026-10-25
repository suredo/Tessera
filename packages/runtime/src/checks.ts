import type { MountedTool } from "./host.ts";

// The checks a candidate runs in the staging panel before it may be activated (RUN-03). M1 has
// only a stub; the static check (VER-01) and the smoke check (VER-02) plug into this interface in
// M2 and M3.

/** A check's verdict: passed, or failed with a plain reason the person could read. */
export type CheckOutcome = { ok: true } | { ok: false; reason: string };

/** What a check gets: the candidate running in the hidden panel, against synthetic data. */
export type CheckContext = {
  /** The candidate, mounted in the panel; it can't write (BRG-06). */
  tool: MountedTool;
  /** The hidden panel, laid out at the narrow width the UI standard sets (320 px wide). */
  panel: HTMLElement;
  /** Aborted when staging is cancelled; a check stops waiting then. */
  signal: AbortSignal;
};

export type VerificationCheck = {
  /** Shown with a failure, so the person knows which check said no. */
  name: string;
  /** True only for a placeholder that checks nothing. */
  stub?: boolean;
  run(context: CheckContext): Promise<CheckOutcome>;
};

/**
 * A STUB, not a check: it checks nothing and gives `outcome`, so staging can be built and tested
 * before the real checks exist (VER-01 and VER-02, M2). Never rely on it to judge a tool.
 */
export const stubCheck = (outcome: CheckOutcome = { ok: true }): VerificationCheck => ({
  name: "stub",
  stub: true,
  run: () => Promise.resolve(outcome),
});
