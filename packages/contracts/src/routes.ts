import { z } from "zod";
import { effortSchema, STAGES, stageSchema, type Stage } from "./provider.ts";

// Which model, at which effort, each stage calls (CLI-09): the cheapest that does the task well,
// chosen by the kind of task, never switched to a pricier model on failure (A18, confirmed by the
// owner on 2026-10-26). The defaults are a starting point, revisited with M2's measurements.

/** The Claude models a route may name, by the names the CLI takes. */
export const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export const modelSchema = z.enum(MODELS);
export type Model = z.infer<typeof modelSchema>;

export const routeSchema = z
  .strictObject({ model: modelSchema, effort: effortSchema })
  .describe("The model and effort one stage's calls use.");
export type Route = z.infer<typeof routeSchema>;

const HAIKU_LOW: Route = { model: "claude-haiku-5-5", effort: "low" };
const SONNET_LOW: Route = { model: "claude-sonnet-5-5", effort: "low" };
const SONNET_MEDIUM: Route = { model: "claude-sonnet-5-5", effort: "medium" };

/**
 * The starting routes (A18). Opus appears in none: it is used only when configured explicitly.
 * The evaluation reviewer (EVAL-03), which A18 doesn't name, starts where creation does.
 */
export const DEFAULT_ROUTES: Readonly<Record<Stage, Route>> = {
  intent: HAIKU_LOW,
  data: HAIKU_LOW,
  acceptance: HAIKU_LOW,
  create: SONNET_MEDIUM,
  repair: SONNET_MEDIUM,
  edit: SONNET_LOW,
  research: SONNET_MEDIUM,
  review: SONNET_MEDIUM,
};

/** A routes file: some stages' routes, which replace the defaults for those stages only. */
export const routeOverridesSchema = z
  .partialRecord(stageSchema, routeSchema)
  .describe("Routes that replace the defaults for the stages they name (CLI-09).");
export type RouteOverrides = z.infer<typeof routeOverridesSchema>;

/** The routes in use: the defaults, with any configured stage replaced. */
export const withOverrides = (overrides: RouteOverrides): Readonly<Record<Stage, Route>> =>
  Object.fromEntries(
    STAGES.map((stage) => [stage, overrides[stage] ?? DEFAULT_ROUTES[stage]]),
  ) as Record<Stage, Route>;
