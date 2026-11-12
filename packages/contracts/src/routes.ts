import { z } from "zod";
import { effortSchema, STAGES, stageSchema, type Stage } from "./provider.ts";

// Which model, at which effort, each stage calls (CLI-09): the cheapest that does the task well,
// chosen by the kind of task, never switched to a pricier model on failure (A18, confirmed by the
// owner on 2026-10-26). The defaults are a starting point, revisited with M2's measurements.

/** The programs Tessera can reach a model through (CLI-01): Claude Code, or Codex from M3. */
export const PROVIDERS = ["claude-code", "codex"] as const;
export const providerSchema = z.enum(PROVIDERS);
export type ProviderName = z.infer<typeof providerSchema>;

/** The Claude models a route may name, by the names the CLI takes. */
export const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

/**
 * The Codex models a route may name: those a ChatGPT plan's Codex listed on 2026-11-07 (the
 * Codex probe, #266). A ChatGPT sign-in can't use gpt-5.5, so it isn't here.
 */
export const CODEX_MODELS = [
  "gpt-6-luna",
  "gpt-6.1-terra",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-astra",
] as const;

/** Every model a route may name, of either program. */
export const MODELS = [...CLAUDE_MODELS, ...CODEX_MODELS] as const;
export const modelSchema = z.enum(MODELS);
export type Model = z.infer<typeof modelSchema>;

/** The models each program takes. */
export const MODELS_BY_PROVIDER: Readonly<Record<ProviderName, readonly Model[]>> = {
  "claude-code": CLAUDE_MODELS,
  codex: CODEX_MODELS,
};

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
  discuss: HAIKU_LOW,
  create: SONNET_MEDIUM,
  repair: SONNET_MEDIUM,
  edit: SONNET_LOW,
  research: SONNET_MEDIUM,
  review: SONNET_MEDIUM,
};

const LUNA_LOW: Route = { model: "gpt-6-luna", effort: "low" };
const SOL_LOW: Route = { model: "gpt-6.1-sol", effort: "low" };
const SOL_MEDIUM: Route = { model: "gpt-6.1-sol", effort: "medium" };

/**
 * Codex's starting routes (CLI-09), by the same kinds of task as Claude's: the fast, cheap model
 * where Claude's routes use Haiku, the plan's everyday model where they use Sonnet. Astra, the
 * plan's most capable, appears in none, as Opus doesn't.
 */
export const CODEX_DEFAULT_ROUTES: Readonly<Record<Stage, Route>> = {
  intent: LUNA_LOW,
  data: LUNA_LOW,
  acceptance: LUNA_LOW,
  discuss: LUNA_LOW,
  create: SOL_MEDIUM,
  repair: SOL_MEDIUM,
  edit: SOL_LOW,
  research: SOL_MEDIUM,
  review: SOL_MEDIUM,
};

/** The starting routes of each program. */
export const DEFAULT_ROUTES_BY_PROVIDER: Readonly<
  Record<ProviderName, Readonly<Record<Stage, Route>>>
> = { "claude-code": DEFAULT_ROUTES, codex: CODEX_DEFAULT_ROUTES };

/** A routes file: some stages' routes, which replace the defaults for those stages only. */
export const routeOverridesSchema = z
  .partialRecord(stageSchema, routeSchema)
  .describe("Routes that replace the defaults for the stages they name (CLI-09).");
export type RouteOverrides = z.infer<typeof routeOverridesSchema>;

/** The routes in use: a program's defaults, with any configured stage replaced. */
export const withOverrides = (
  overrides: RouteOverrides,
  provider: ProviderName = "claude-code",
): Readonly<Record<Stage, Route>> =>
  Object.fromEntries(
    STAGES.map((stage) => [stage, overrides[stage] ?? DEFAULT_ROUTES_BY_PROVIDER[provider][stage]]),
  ) as Record<Stage, Route>;
