// Docs: docs/code/server/generation.md
import type { Intent } from "@tessera/contracts";

// Two passes for big tools (GEN-17, A17), a starting point measured against one pass before it
// becomes the default: when a new tool is asked for with many separate features, the first pass
// builds a small working core, and the rest arrive later as edits, each checked. The host decides
// from the intent stage's list of features with a fixed threshold, never from a model's own
// "large" flag (L-37). Off unless the server is given the options.

export type TwoPassOptions = {
  /** How many features a new tool must ask for before it is made in two passes. */
  minFeatures: number;
  /** How many of them, the first in the request's order, the core pass builds. */
  coreFeatures: number;
};

/** The starting point to measure (A17); the server uses it only when told to. */
export const TWO_PASS_STARTING_POINT: TwoPassOptions = { minFeatures: 4, coreFeatures: 2 };

export type Feature = Intent["features"][number];

/** What the core pass builds now, and what comes later as edits, in the request's order. */
export type TwoPassPlan = { core: Feature[]; later: Feature[] };

/** Refuses options that would make no core, or no second pass. */
export function checkTwoPassOptions(options: TwoPassOptions): TwoPassOptions {
  const { minFeatures, coreFeatures } = options;
  if (!Number.isInteger(minFeatures) || !Number.isInteger(coreFeatures))
    throw new RangeError("Two-pass options must be whole numbers.");
  if (coreFeatures < 1 || minFeatures <= coreFeatures)
    throw new RangeError(
      "Two passes need a core of at least one feature, and some left for later.",
    );
  return options;
}

/**
 * The two-pass plan for a request, or none for one made in one pass: only a new tool (create or
 * new tool) with at least `minFeatures` separate features. The core is the first `coreFeatures`.
 */
export function twoPassPlan(intent: Intent, options?: TwoPassOptions): TwoPassPlan | undefined {
  if (!options) return undefined;
  if (intent.kind !== "create" && intent.kind !== "new_tool") return undefined;
  if (intent.features.length < options.minFeatures) return undefined;
  return {
    core: intent.features.slice(0, options.coreFeatures),
    later: intent.features.slice(options.coreFeatures),
  };
}
