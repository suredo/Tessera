import fs from "node:fs";
import {
  DEFAULT_ROUTES,
  EFFORTS,
  MODELS,
  routeOverridesSchema,
  STAGES,
  withOverrides,
  type Route,
  type Stage,
} from "@tessera/contracts";
import type { z } from "zod";
import type { Provider, StageResult } from "./provider.ts";

// Each stage runs on its route (CLI-09): the model and effort the routing table gives it, the
// cheapest that fits the task. The table is the defaults, with any stage a routes file names
// replaced. A failed call is never retried on another model: there is no automatic escalation.

/** The routes a stage may run on, by stage. */
export type Routes = Readonly<Record<Stage, Route>>;

/** The name of the optional routes file in the data folder. */
export const ROUTES_FILE = "routes.json";

/** A routes file that can't be used, with what is wrong with it in plain words. */
export class RoutesError extends Error {
  override name = "RoutesError";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const list = (items: readonly string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
// A value as the person wrote it, quoted, if it is a plain one; never coerced, which can throw.
const shown = (value: unknown) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? `"${value}"`
    : "something that isn't a name";

/**
 * What is wrong with a routes file's content, in plain words (GEN-12), or undefined if nothing
 * is: which step is affected, and what it may say instead.
 */
function problemWith(content: unknown): string | undefined {
  if (!isObject(content)) return "it should list steps, each with a model and an effort";
  for (const [stage, route] of Object.entries(content)) {
    if (!(STAGES as readonly string[]).includes(stage)) {
      return `it names a step Tessera doesn't have, "${stage}"; the steps are ${list(STAGES)}`;
    }
    if (!isObject(route) || !("model" in route) || !("effort" in route)) {
      return `the ${stage} step needs both a model and an effort`;
    }
    const extra = Object.keys(route).filter((key) => key !== "model" && key !== "effort");
    if (extra.length > 0) {
      return `the ${stage} step has "${extra[0]}", but a step has only a model and an effort`;
    }
    if (!(MODELS as readonly unknown[]).includes(route["model"])) {
      return `the ${stage} step names a model Tessera doesn't know, ${shown(route["model"])}; the models are ${list(MODELS)}`;
    }
    if (!(EFFORTS as readonly unknown[]).includes(route["effort"])) {
      return `the ${stage} step's effort should be ${list(EFFORTS)}, not ${shown(route["effort"])}`;
    }
  }
  return undefined;
}

/**
 * The routes in use: the defaults, with the stages `file` names replaced. A missing file means the
 * defaults. A file Tessera can't use is refused with a plain message that says what to change, so
 * a mistake there never silently falls back to some other route.
 */
export function loadRoutes(file: string): Routes {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return DEFAULT_ROUTES;
    throw error;
  }
  const refuse = (why: string) =>
    new RoutesError(
      `Tessera can't use the model settings in ${file}: ${why}. Correct it, or delete the file to use the standard settings.`,
    );
  let content: unknown;
  try {
    content = JSON.parse(text);
  } catch {
    throw refuse("its text isn't written in the settings format");
  }
  const problem = problemWith(content);
  if (problem !== undefined) throw refuse(problem);
  // The contract has the last word; the checks above only put its refusals into plain words.
  const parsed = routeOverridesSchema.safeParse(content);
  if (!parsed.success) throw refuse("one of its steps isn't written as a model and an effort");
  return withOverrides(parsed.data);
}

/** One stage call, without its route: the routing table supplies the model and effort. */
export type StageCall<T> = {
  stage: Stage;
  system: string;
  prompt: string;
  promptParts?: readonly string[];
  schema: z.ZodType<T>;
  timeLimitMs: number;
  signal?: AbortSignal;
};

/**
 * Runs a stage on its route, once. Only research gets web tools (CLI-03). A failure is the
 * caller's to report or repair on the same route; it is never retried here on another model.
 */
export function runStage<T>(
  provider: Provider,
  routes: Routes,
  call: StageCall<T>,
): Promise<StageResult<T>> {
  const route = routes[call.stage];
  return provider.run({
    ...call,
    model: route.model,
    effort: route.effort,
    tools: call.stage === "research" ? "web" : "none",
  });
}
