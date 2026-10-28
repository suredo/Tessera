import {
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  generateReplySchema,
  generateRequestSchema,
  smokeRepairRequestSchema,
} from "@tessera/contracts";
import { json, readJson, text } from "../http/body.ts";
import type { Handler } from "../http/server.ts";
import type { JobQueue } from "../jobs/index.ts";
import { RoutesError, type Provider, type Routes } from "../providers/index.ts";
import type { Store } from "../workspaces/index.ts";
import { generate } from "./pipeline.ts";
import { repairSmoke, type SmokeRepairContext } from "./smoke.ts";

// The host app's route for a request (GEN-01): it runs as a job, one at a time (CLI-06), and
// answers with what came of it, checked against the contract (CON-01). The local server's guard
// has already checked the request comes from the host app (SEC-03).

const REQUEST_LIMIT_BYTES = 16 * 1024;
const FAILED = "Tessera couldn't carry out that request. Nothing was changed.";

export type GenerationOptions = {
  store: Store;
  jobs: JobQueue;
  /** The provider to call, found when a request comes: the setup check may have changed since. */
  provider: () => Promise<Provider | { problem: string }>;
  routes: () => Routes;
};

export function generationRoutes(options: GenerationOptions): Record<string, Handler> {
  // Short-lived continuations, bounded in memory and consumed before a repair call. Restarting
  // loses eligibility, never resets it; a replay or a parallel POST cannot spend another call.
  const pending = new Map<string, { context: SmokeRepairContext; expires: number }>();
  const key = (workspaceId: string, hash: string) => `${workspaceId}:${hash}`;
  const remember = (context: SmokeRepairContext) => {
    for (const [id, entry] of pending) if (entry.expires <= Date.now()) pending.delete(id);
    if (pending.size >= 100) pending.delete(pending.keys().next().value!);
    pending.set(key(context.reply.workspaceId, context.reply.hash), {
      context,
      expires: Date.now() + 7 * 60_000,
    });
  };
  const handle =
    (repair: boolean): Handler =>
    async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
      const body = await readJson(req, REQUEST_LIMIT_BYTES);
      if (body === "too-large") return text(res, 413, "The request is too long.");
      const request =
        body === "invalid"
          ? undefined
          : (repair ? smokeRepairRequestSchema : generateRequestSchema).safeParse(body.json);
      if (!request?.success) return text(res, 400, "Say what you need, in a few words.");
      const provider = await options.provider();
      if ("problem" in provider) {
        return json(
          res,
          generateReplySchema.parse({
            kind: "failed",
            failure: "provider",
            message: provider.problem,
            findings: [],
          }),
        );
      }
      let routes: Routes;
      try {
        routes = options.routes();
      } catch (error) {
        // Such as a routes file Tessera can't use: its own plain words (CLI-09).
        const message = error instanceof RoutesError ? error.message : FAILED;
        return json(
          res,
          generateReplySchema.parse({ kind: "failed", failure: "provider", message, findings: [] }),
        );
      }
      const input = request.data;
      const { outcome } = options.jobs.submit(
        "findings" in input ? "Repair tool" : input.request,
        (signal) => {
          if (!("findings" in input))
            return generate(options.store, provider, routes, input, signal, remember);
          const id = key(input.workspaceId, input.hash);
          const entry = pending.get(id);
          pending.delete(id);
          return repairSmoke(
            options.store,
            provider,
            routes,
            input,
            entry && entry.expires > Date.now() ? entry.context : undefined,
            signal,
          );
        },
      );
      const ended = await outcome;
      if (ended.state === "done") return json(res, generateReplySchema.parse(ended.value));
      return json(
        res,
        generateReplySchema.parse({
          kind: "failed",
          failure: "provider",
          message: ended.state === "cancelled" ? "The request was stopped." : FAILED,
          findings: [],
        }),
      );
    };
  return { [GENERATE_ROUTE]: handle(false), [SMOKE_REPAIR_ROUTE]: handle(true) };
}
