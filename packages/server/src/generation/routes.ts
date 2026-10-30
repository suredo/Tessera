import {
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  generateReplySchema,
  generateRequestSchema,
  smokeRepairRequestSchema,
  CONFIRM_DATA_ROUTE,
  confirmDataRequestSchema,
  type GenerateReply,
  type ActivationRequest,
  FINISH_DATA_ROUTE,
  finishDataRequestSchema,
} from "@tessera/contracts";
import { randomUUID } from "node:crypto";
import { json, readJson, text } from "../http/body.ts";
import type { Handler } from "../http/server.ts";
import type { JobQueue } from "../jobs/index.ts";
import { ProviderError, RoutesError, type Provider, type Routes } from "../providers/index.ts";
import { activationRoutes, getWorkspace, type Store } from "../workspaces/index.ts";
import type { GenerationResult } from "./result.ts";
import { generate } from "./pipeline.ts";
import { repairSmoke, type SmokeRepairContext } from "./smoke.ts";
import { REQUEST_TIME_LIMIT_MS, withinRequestDeadline } from "./deadline.ts";
import { applyDataOffer, changeData, type DataOffer } from "./data-action.ts";

// The host app's route for a request (GEN-01): it runs as a job, one at a time (CLI-06), and
// answers with what came of it, checked against the contract (CON-01). The local server's guard
// has already checked the request comes from the host app (SEC-03).

const REQUEST_LIMIT_BYTES = 16 * 1024;
const FAILED = "Tessera couldn't carry out that request. Nothing was changed.";
const MAX_PENDING = 100;

export type GenerationOptions = {
  store: Store;
  jobs: JobQueue;
  /** The provider to call, found when a request comes: the setup check may have changed since. */
  provider: () => Promise<Provider | { problem: string }>;
  routes: () => Routes;
  /** Total stage time after a queued request starts, including later smoke repair (GEN-11). */
  requestTimeLimitMs?: number;
};

export function generationRoutes(options: GenerationOptions): Record<string, Handler> {
  const limit = options.requestTimeLimitMs ?? REQUEST_TIME_LIMIT_MS;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647)
    throw new RangeError("requestTimeLimitMs must be a positive timer-sized integer.");
  // Short-lived continuations, bounded in memory and consumed before a repair call. Restarting
  // loses eligibility, never resets it; a replay or a parallel POST cannot spend another call.
  const pending = new Map<string, { context: SmokeRepairContext; expires: number }>();
  const waitingData = new Map<string, { context: SmokeRepairContext; expires: number }>();
  const offers = new Map<string, { offer: DataOffer; expires: number }>();
  const activations = new Map<string, Omit<ActivationRequest, "token"> & { expires: number }>();
  const grant = (reply: GenerationResult, expires: number, token: string): GenerateReply => {
    if (reply.kind !== "candidate") return reply;
    for (const [token, entry] of activations)
      if (entry.expires <= Date.now()) activations.delete(token);
    if (activations.size >= MAX_PENDING) activations.delete(activations.keys().next().value!);
    activations.set(token, {
      workspaceId: reply.workspaceId,
      hash: reply.hash,
      expectedDataRevision: reply.expectedDataRevision,
      expires,
    });
    return { ...reply, activation: { token, expiresAt: expires } };
  };
  const activate = activationRoutes(options.store, (request) => {
    const entry = activations.get(request.token);
    if (
      !entry ||
      entry.workspaceId !== request.workspaceId ||
      entry.hash !== request.hash ||
      entry.expectedDataRevision !== request.expectedDataRevision
    )
      return undefined;
    // Consume before validation/migration; a refusal or concurrent replay cannot reuse authority.
    activations.delete(request.token);
    return () => Date.now() < entry.expires;
  });
  const offerData = (offer: DataOffer, expires: number) => {
    for (const [token, value] of offers) if (value.expires <= Date.now()) offers.delete(token);
    if (offers.size >= MAX_PENDING) offers.delete(offers.keys().next().value!);
    const token = randomUUID();
    offers.set(token, { offer, expires });
    return token;
  };
  const available = (context: SmokeRepairContext) => {
    const workspace = getWorkspace(options.store, context.reply.workspaceId);
    for (const [token, entry] of [...pending, ...waitingData]) {
      if (
        entry.context.reply.workspaceId === context.reply.workspaceId &&
        entry.context.reply.hash === context.reply.hash &&
        entry.expires > Date.now() &&
        (waitingData.has(token) ||
          (workspace?.currentVersion === entry.context.baseVersion &&
            workspace.dataRevision === entry.context.reply.expectedDataRevision))
      )
        throw new ProviderError(
          "cancelled",
          "Another request is still checking this tool. Finish it before asking again.",
        );
    }
  };
  const retain = (
    map: typeof pending,
    token: string,
    context: SmokeRepairContext,
    expires: number,
  ) => {
    for (const [id, entry] of map) if (entry.expires <= Date.now()) map.delete(id);
    if (map.size >= MAX_PENDING) map.delete(map.keys().next().value!);
    map.set(token, { context, expires });
  };
  const remember = (token: string, context: SmokeRepairContext, expires: number) => {
    // Equal code hashes can belong to different requests. Never replace their instructions.
    available(context);
    retain(pending, token, context, expires);
    if (context.dataPart) retain(waitingData, token, context, expires);
  };
  const handle =
    (mode: "generate" | "smoke" | "data"): Handler =>
    async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
      const body = await readJson(req, REQUEST_LIMIT_BYTES);
      if (body === "too-large") return text(res, 413, "The request is too long.");
      const request =
        body === "invalid"
          ? undefined
          : (mode === "smoke"
              ? smokeRepairRequestSchema
              : mode === "data"
                ? finishDataRequestSchema
                : generateRequestSchema
            ).safeParse(body.json);
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
      const nextToken = randomUUID();
      let expires = 0;
      const { outcome } = options.jobs.submit(
        "request" in input ? input.request : "findings" in input ? "Repair tool" : "Change entries",
        (signal) => {
          if ("request" in input) {
            expires = Date.now() + limit;
            return withinRequestDeadline(
              provider,
              expires,
              (bounded, stopped, check) =>
                generate(
                  options.store,
                  bounded,
                  routes,
                  input,
                  stopped,
                  (context) => remember(nextToken, context, expires),
                  check,
                  (offer) => offerData(offer, expires),
                ),
              signal,
            );
          }
          const id = input.token;
          const matches = (entry: { context: SmokeRepairContext } | undefined) =>
            entry?.context.reply.workspaceId === input.workspaceId &&
            entry.context.reply.hash === input.hash;
          if (!("findings" in input)) {
            const entry = waitingData.get(id);
            if (!entry?.context.dataPart || !matches(entry))
              return Promise.resolve<GenerateReply>({
                kind: "failed",
                failure: "provider",
                message: "The entry changes weren't applied. Please ask for them again.",
                findings: [],
              });
            waitingData.delete(id);
            pending.delete(id);
            return withinRequestDeadline(
              provider,
              entry.expires,
              (bounded, stopped, check) => {
                if (getWorkspace(options.store, input.workspaceId)?.currentVersion !== input.hash)
                  return Promise.resolve<GenerateReply>({ kind: "answer", answer: "data_stale" });
                return changeData(
                  options.store,
                  bounded,
                  routes,
                  input.workspaceId,
                  entry.context.dataPart!,
                  entry.context.intent.language,
                  stopped,
                  check,
                  (offer) => offerData(offer, entry.expires),
                  entry.context.repairUsage,
                );
              },
              signal,
            );
          }
          const smokeInput = smokeRepairRequestSchema.parse(input);
          const entry = pending.get(id);
          if (!entry || !matches(entry))
            return repairSmoke(options.store, provider, routes, smokeInput, undefined, signal);
          pending.delete(id);
          waitingData.delete(id);
          activations.delete(id);
          expires = entry.expires;
          return withinRequestDeadline(
            provider,
            entry.expires,
            async (bounded, stopped, check) => {
              const repaired = await repairSmoke(
                options.store,
                bounded,
                routes,
                smokeInput,
                entry.context,
                stopped,
                check,
              );
              if (repaired.kind === "candidate" && entry.context.dataPart) {
                available({ ...entry.context, reply: repaired });
                retain(
                  waitingData,
                  nextToken,
                  { ...entry.context, reply: repaired },
                  entry.expires,
                );
              }
              return repaired;
            },
            signal,
          );
        },
      );
      const ended = await outcome;
      if (ended.state === "done")
        return json(res, generateReplySchema.parse(grant(ended.value, expires, nextToken)));
      return json(
        res,
        generateReplySchema.parse({
          kind: "failed",
          failure: "provider",
          message:
            ended.state === "cancelled"
              ? "The request was stopped."
              : ended.state === "failed" && ended.error instanceof ProviderError
                ? ended.error.message
                : mode === "data"
                  ? "The entry changes weren't applied."
                  : FAILED,
          findings: [],
        }),
      );
    };
  const confirm: Handler = async (req, res) => {
    if (req.method !== "POST") return text(res, 405, "Send a confirmation with POST.");
    const body = await readJson(req, REQUEST_LIMIT_BYTES);
    if (body === "too-large") return text(res, 413, "The confirmation is too long.");
    const checked = body === "invalid" ? undefined : confirmDataRequestSchema.safeParse(body.json);
    if (!checked?.success) return text(res, 400, "Choose whether to apply the proposed changes.");
    const entry = offers.get(checked.data.token);
    offers.delete(checked.data.token); // Consume before any queued work, including cancellation.
    if (!checked.data.approve) return json(res, { kind: "answer", answer: "data_cancelled" });
    const { outcome } = options.jobs.submit(
      "Apply reviewed entry changes",
      (signal): Promise<GenerateReply> => {
        if (!entry)
          return Promise.resolve({
            kind: "failed",
            failure: "provider",
            message: "This review expired. Please ask for the change again.",
            findings: [],
          });
        const check = () => {
          signal.throwIfAborted();
          if (Date.now() >= entry.expires)
            throw new ProviderError(
              "time_limit",
              "This review expired. Please ask for the change again.",
            );
        };
        return Promise.resolve(applyDataOffer(options.store, entry.offer, check));
      },
    );
    const ended = await outcome;
    return json(
      res,
      generateReplySchema.parse(
        ended.state === "done"
          ? ended.value
          : {
              kind: "failed",
              failure: "provider",
              message:
                ended.state === "failed" && ended.error instanceof ProviderError
                  ? ended.error.message
                  : FAILED,
              findings: [],
            },
      ),
    );
  };
  return {
    ...activate,
    [GENERATE_ROUTE]: handle("generate"),
    [SMOKE_REPAIR_ROUTE]: handle("smoke"),
    [FINISH_DATA_ROUTE]: handle("data"),
    [CONFIRM_DATA_ROUTE]: confirm,
  };
}
