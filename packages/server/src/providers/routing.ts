import fs from "node:fs";
import {
  DEFAULT_ROUTES,
  routeOverridesSchema,
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

/**
 * The routes in use: the defaults, with the stages `file` names replaced. A missing file means the
 * defaults. A file that isn't valid, or names an unknown stage, model or effort, is refused with
 * a plain message, so a mistake there never silently falls back to some other route.
 */
export function loadRoutes(file: string): Routes {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return DEFAULT_ROUTES;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RoutesError(`The routes file ${file} isn't valid JSON, so Tessera can't use it.`);
  }
  const parsed = routeOverridesSchema.safeParse(json);
  if (!parsed.success) {
    const problem = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "the file"}: ${issue.message}`)
      .join("; ");
    throw new RoutesError(`The routes file ${file} has something Tessera can't use (${problem}).`);
  }
  return withOverrides(parsed.data);
}

/** One stage call, without its route: the routing table supplies the model and effort. */
export type StageCall<T> = {
  stage: Stage;
  system: string;
  prompt: string;
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
