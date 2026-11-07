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
  type VersionNote,
  FINISH_DATA_ROUTE,
  finishDataRequestSchema,
  FOLLOW_UP_ROUTE,
  followUpRequestSchema,
  REGISTER_REQUEST_ROUTE,
  CANCEL_REQUEST_ROUTE,
  requestControlSchema,
  cancelRequestReplySchema,
  PROGRESS_REQUEST_ROUTE,
  requestProgressSchema,
} from "@tessera/contracts";
import { randomUUID } from "node:crypto";
import { json, readJson, text } from "../http/body.ts";
import type { Handler } from "../http/server.ts";
import type { JobQueue } from "../jobs/index.ts";
import { ProviderError, RoutesError, type Provider, type Routes } from "../providers/index.ts";
import { activationRoutes, getWorkspace, type Store } from "../workspaces/index.ts";
import type { GenerationResult } from "./result.ts";
import { generate } from "./pipeline.ts";
import { generateEdit } from "./edit-pipeline.ts";
import { repairSmoke, type SmokeRepairContext } from "./smoke.ts";
import { REQUEST_TIME_LIMIT_MS, withinRequestDeadline } from "./deadline.ts";
import { applyDataOffer, changeData, type DataOffer } from "./data-action.ts";
import { RequestLedger } from "../ledger/index.ts";
import { RequestControls } from "./control.ts";
import { checkTwoPassOptions, type TwoPassOptions } from "./two-pass.ts";

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
  /** Where each request and its model calls are recorded (OBS-01); the store's own by default. */
  ledger?: RequestLedger;
  /** Makes a big new tool in two passes, its core first (GEN-17); one pass when left out. */
  twoPass?: TwoPassOptions;
};

export function generationRoutes(options: GenerationOptions): Record<string, Handler> {
  const limit = options.requestTimeLimitMs ?? REQUEST_TIME_LIMIT_MS;
  const twoPass = options.twoPass && checkTwoPassOptions(options.twoPass);
  const ledger = options.ledger ?? new RequestLedger(options.store);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_147_483_647)
    throw new RangeError("requestTimeLimitMs must be a positive timer-sized integer.");
  // Short-lived continuations, bounded in memory and consumed before a repair call. Restarting
  // loses eligibility, never resets it; a replay or a parallel POST cannot spend another call.
  const pending = new Map<string, { context: SmokeRepairContext; expires: number }>();
  const waitingData = new Map<string, { context: SmokeRepairContext; expires: number }>();
  // A big tool's features still to come (GEN-17), for after the version before them activates.
  const waitingFollowUps = new Map<string, { context: SmokeRepairContext; expires: number }>();
  const offers = new Map<string, { offer: DataOffer; expires: number }>();
  const activations = new Map<
    string,
    Omit<ActivationRequest, "token"> & { expires: number; summary: string }
  >();
  const controls = new RequestControls(options.jobs, (token) => {
    pending.delete(token);
    waitingData.delete(token);
    waitingFollowUps.delete(token);
    offers.delete(token);
    activations.delete(token);
  });
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
      summary: reply.summary,
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
    const control = controls.owner(request.token);
    // The version keeps its summary and the checks its candidate passed (APP-05): the host's code
    // check before it was stored, and the start check the app's staging ran before asking this.
    return Object.assign(
      () => Date.now() < entry.expires && (!control || !control.controller.signal.aborted),
      { note: { summary: entry.summary, checks: ["code", "start"] } as VersionNote },
    );
  });
  const offerData = (
    offer: DataOffer,
    expires: number,
    control?: ReturnType<RequestControls["owner"]>,
  ) => {
    for (const [token, value] of offers) if (value.expires <= Date.now()) offers.delete(token);
    if (offers.size >= MAX_PENDING) offers.delete(offers.keys().next().value!);
    const token = randomUUID();
    controls.bind(control, token);
    offers.set(token, { offer, expires });
    return token;
  };
  const available = (context: SmokeRepairContext) => {
    const workspace = getWorkspace(options.store, context.reply.workspaceId);
    for (const [token, entry] of [...pending, ...waitingData, ...waitingFollowUps]) {
      if (
        entry.context.reply.workspaceId === context.reply.workspaceId &&
        entry.context.reply.hash === context.reply.hash &&
        entry.expires > Date.now() &&
        (waitingData.has(token) ||
          waitingFollowUps.has(token) ||
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
  /** Keeps a follow-up continuation, and its owner as long, so Cancel still reaches it (GEN-17). */
  const keepFollowUps = (
    token: string,
    context: SmokeRepairContext,
    until: number,
    control: ReturnType<RequestControls["owner"]>,
  ) => {
    retain(waitingFollowUps, token, context, until);
    if (control) control.expires = Math.max(control.expires, until);
  };
  const remember = (
    token: string,
    context: SmokeRepairContext,
    expires: number,
    control?: ReturnType<RequestControls["owner"]>,
  ) => {
    // Equal code hashes can belong to different requests. Never replace their instructions.
    available(context);
    retain(pending, token, context, expires);
    if (context.dataPart) retain(waitingData, token, context, expires);
    // A follow-up is its own request with its own time limit, so its continuation outlives this
    // request's deadline by one request's limit, and no more (GEN-11).
    if (context.plan?.later.length) keepFollowUps(token, context, expires + limit, control);
  };
  const handle =
    (mode: "generate" | "smoke" | "data" | "follow-up"): Handler =>
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
                : mode === "follow-up"
                  ? followUpRequestSchema
                  : generateRequestSchema
            ).safeParse(body.json);
      if (!request?.success) return text(res, 400, "Say what you need, in a few words.");
      const input = request.data;
      let control: ReturnType<RequestControls["owner"]>;
      try {
        control =
          "request" in input
            ? input.controlToken
              ? controls.claim(input.controlToken)
              : undefined
            : controls.owner(input.token);
        if (control) controls.check(control);
      } catch {
        return text(res, 409, "The request was stopped or expired. Please ask again.");
      }
      // From here every reply is recorded with the request, and each model call too (OBS-01).
      const recorded = ledger.start(
        mode === "smoke" ? "repair" : mode === "data" ? "data" : "generate",
        input.workspaceId,
      );
      const answer = (value: unknown) => {
        const reply = generateReplySchema.parse(value);
        ledger.finish(recorded, reply);
        return json(res, reply);
      };
      const found = await options.provider();
      if ("problem" in found) {
        return answer({
          kind: "failed",
          failure: "provider",
          message: found.problem,
          findings: [],
        });
      }
      // Each model call names its stage, for the request's progress (GEN-16, ADR 0010).
      const provider = controls.watch(control, ledger.record(recorded, found));
      let routes: Routes;
      try {
        routes = options.routes();
      } catch (error) {
        // Such as a routes file Tessera can't use: its own plain words (CLI-09).
        const message = error instanceof RoutesError ? error.message : FAILED;
        return answer({ kind: "failed", failure: "provider", message, findings: [] });
      }
      // Cancellation during asynchronous discovery must win before a job can be submitted.
      if (control) {
        try {
          controls.check(control);
        } catch {
          ledger.finish(recorded, {
            kind: "failed",
            failure: "provider",
            message: "The request was stopped.",
            findings: [],
          });
          return text(res, 409, "The request was stopped or expired. Please ask again.");
        }
        if ("request" in input) control.expires = Infinity; // Queue waiting precedes the deadline.
      }
      const nextToken = randomUUID();
      let expires = 0;
      controls.waiting(control);
      const { job, outcome } = options.jobs.submit(
        "request" in input
          ? input.request
          : "findings" in input
            ? "Repair tool"
            : mode === "follow-up"
              ? "Add a feature"
              : "Change entries",
        (jobSignal) => {
          const signal = control
            ? AbortSignal.any([jobSignal, control.controller.signal])
            : jobSignal;
          if (control) controls.check(control);
          if ("request" in input) {
            expires = Date.now() + limit;
            if (control) control.expires = expires;
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
                  (context) => {
                    controls.bind(control, nextToken);
                    remember(nextToken, context, expires, control);
                  },
                  check,
                  (offer) => offerData(offer, expires, control),
                  twoPass,
                ),
              signal,
            );
          }
          const id = input.token;
          const matches = (entry: { context: SmokeRepairContext } | undefined) =>
            entry?.context.reply.workspaceId === input.workspaceId &&
            entry.context.reply.hash === input.hash;
          if (mode === "follow-up") {
            const entry = waitingFollowUps.get(id);
            const plan = entry?.context.plan;
            if (!entry || !plan?.later.length || !matches(entry) || entry.expires <= Date.now())
              return Promise.resolve<GenerateReply>({
                kind: "failed",
                failure: "provider",
                message: "The rest of the tool wasn't added. Please ask for it again.",
                findings: [],
              });
            // Consumed before any call: a replay or a parallel POST can't add a feature twice.
            waitingFollowUps.delete(id);
            pending.delete(id);
            waitingData.delete(id);
            // Each feature is its own request, with a request's whole time limit (GEN-11).
            expires = Date.now() + limit;
            if (control) control.expires = expires;
            const [feature, ...rest] = plan.later as [
              (typeof plan.later)[number],
              ...typeof plan.later,
            ];
            const next = { core: [...plan.core, feature], later: rest };
            const followUps = rest.map((later) => later.name);
            return withinRequestDeadline<GenerationResult>(
              provider,
              expires,
              async (bounded, stopped, check) => {
                const baseline = getWorkspace(options.store, input.workspaceId);
                if (baseline?.currentVersion !== input.hash)
                  return { kind: "answer", answer: "stale" } as const;
                // The host's own intent for the feature: an edit of the tool now open, in the
                // request's language, with what it adds; no intent call is spent on it (L-37).
                const edited = await generateEdit(
                  options.store,
                  bounded,
                  routes,
                  baseline,
                  feature.request,
                  {
                    ...entry.context.intent,
                    kind: "edit",
                    interfacePart: feature.request,
                    dataPart: null,
                    targetsCurrentTool: true,
                    behaviorChange: true,
                    lookOnly: false,
                    features: [feature],
                  },
                  stopped,
                  (context) => {
                    controls.bind(control, nextToken);
                    remember(
                      nextToken,
                      {
                        ...context,
                        plan: next,
                        reply: { ...context.reply, ...(rest.length ? { followUps } : {}) },
                      },
                      expires,
                      control,
                    );
                  },
                  check,
                );
                return edited.kind === "candidate" && rest.length
                  ? { ...edited, followUps }
                  : edited;
              },
              signal,
            );
          }
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
            return withinRequestDeadline<GenerateReply>(
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
                  (offer) => offerData(offer, entry.expires, control),
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
              if (control?.controller.signal.aborted) return repaired;
              if (repaired.kind === "candidate") controls.bind(control, nextToken);
              if (repaired.kind === "candidate" && entry.context.plan?.later.length) {
                available({ ...entry.context, reply: repaired });
                keepFollowUps(
                  nextToken,
                  { ...entry.context, reply: repaired },
                  entry.expires + limit,
                  control,
                );
              }
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
      control?.jobs.add(job.id);
      const ended = await outcome;
      control?.jobs.delete(job.id);
      controls.idle(control);
      if (control && control.expires === Infinity) control.expires = Date.now() + limit;
      if (ended.state === "done") {
        // Committed data facts stand. Cancelled candidates must never regain activation authority.
        if (ended.value.kind === "candidate" && !control?.controller.signal.aborted)
          controls.bind(control, nextToken);
        const reply =
          ended.value.kind === "candidate" && control?.controller.signal.aborted
            ? {
                kind: "failed",
                failure: "provider",
                message: "The request was stopped.",
                findings: [],
              }
            : grant(ended.value, expires, nextToken);
        return answer(reply);
      }
      return answer({
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
      });
    };
  const confirm: Handler = async (req, res) => {
    if (req.method !== "POST") return text(res, 405, "Send a confirmation with POST.");
    const body = await readJson(req, REQUEST_LIMIT_BYTES);
    if (body === "too-large") return text(res, 413, "The confirmation is too long.");
    const checked = body === "invalid" ? undefined : confirmDataRequestSchema.safeParse(body.json);
    if (!checked?.success) return text(res, 400, "Choose whether to apply the proposed changes.");
    const entry = offers.get(checked.data.token);
    const control = controls.owner(checked.data.token);
    offers.delete(checked.data.token); // Consume before any queued work, including cancellation.
    if (!checked.data.approve) return json(res, { kind: "answer", answer: "data_cancelled" });
    const { job, outcome } = options.jobs.submit(
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
          if (control) controls.check(control);
          if (Date.now() >= entry.expires)
            throw new ProviderError(
              "time_limit",
              "This review expired. Please ask for the change again.",
            );
        };
        return Promise.resolve(applyDataOffer(options.store, entry.offer, check));
      },
    );
    control?.jobs.add(job.id);
    const ended = await outcome;
    control?.jobs.delete(job.id);
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
  const register: Handler = (req, res) => {
    if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
    const token = controls.register();
    if (!token) return text(res, 409, "Too many requests are waiting. Please try again later.");
    return json(res, requestControlSchema.parse({ token }));
  };
  const cancel: Handler = async (req, res) => {
    if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
    const body = await readJson(req, REQUEST_LIMIT_BYTES);
    const checked =
      typeof body === "string" ? undefined : requestControlSchema.safeParse(body.json);
    if (!checked?.success) return text(res, 400, "Choose the request to stop.");
    return json(
      res,
      cancelRequestReplySchema.parse({ cancelled: controls.cancel(checked.data.token) }),
    );
  };
  const progress: Handler = async (req, res) => {
    if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
    const body = await readJson(req, REQUEST_LIMIT_BYTES);
    const checked =
      typeof body === "string" ? undefined : requestControlSchema.safeParse(body.json);
    if (!checked?.success) return text(res, 400, "Choose the request to follow.");
    return json(res, requestProgressSchema.parse(controls.progress(checked.data.token)));
  };
  return {
    ...activate,
    [GENERATE_ROUTE]: handle("generate"),
    [SMOKE_REPAIR_ROUTE]: handle("smoke"),
    [FINISH_DATA_ROUTE]: handle("data"),
    [FOLLOW_UP_ROUTE]: handle("follow-up"),
    [CONFIRM_DATA_ROUTE]: confirm,
    [REGISTER_REQUEST_ROUTE]: register,
    [CANCEL_REQUEST_ROUTE]: cancel,
    [PROGRESS_REQUEST_ROUTE]: progress,
  };
}
