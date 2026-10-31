import {
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  CONFIRM_DATA_ROUTE,
  FINISH_DATA_ROUTE,
  dataReplySchema,
  generateReplySchema,
  type GenerateReply,
  type GenerateRequest,
  type SmokeRepairRequest,
  type ConfirmDataRequest,
  type FinishDataRequest,
  type DataReply,
} from "@tessera/contracts";
import { smokeCheck, stageCandidate, type StagingResult } from "@tessera/runtime";
import { HostError, type Send } from "./host-api.ts";
import { t } from "./i18n/translate.ts";
import type { RequestControl } from "./request-control.ts";

// The host app's side of a request (GEN-01): the server carries it out as far as a candidate, and
// the app stages the candidate behind the smoke check (RUN-03, VER-02) before the server activates
// it (DATA-10). What the person reads is composed here from what happened, never claiming a step
// that didn't succeed (GEN-08).

/** Asks the server to carry out a request; resolves with what came of it. */
export async function askToGenerate(
  request: GenerateRequest,
  send: Send = (url, init) => fetch(url, init),
): Promise<GenerateReply> {
  return askForCandidate(GENERATE_ROUTE, request, send);
}

/** Reports the failed candidate to the server for its one smoke repair (GEN-09). */
export async function askToRepairSmoke(
  request: SmokeRepairRequest,
  send: Send = (url, init) => fetch(url, init),
): Promise<GenerateReply> {
  return askForCandidate(SMOKE_REPAIR_ROUTE, request, send);
}

export const askToConfirmData = (
  request: ConfirmDataRequest,
  send?: Send,
): Promise<GenerateReply> =>
  askForCandidate(CONFIRM_DATA_ROUTE, request, send ?? ((url, init) => fetch(url, init)));

export async function askToFinishData(request: FinishDataRequest, send?: Send): Promise<DataReply> {
  const reply = await askForCandidate(
    FINISH_DATA_ROUTE,
    request,
    send ?? ((url, init) => fetch(url, init)),
  );
  const checked = dataReplySchema.safeParse(reply);
  if (!checked.success) throw new HostError(t("app.unreadable"));
  return checked.data;
}

async function askForCandidate(
  route: string,
  request: GenerateRequest | SmokeRepairRequest | ConfirmDataRequest | FinishDataRequest,
  send: Send,
): Promise<GenerateReply> {
  const response = await send(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const said = await response.text().catch(() => "");
    throw new HostError(
      said && response.status < 500 ? said : t("request.failedPlain"),
      response.status,
    );
  }
  const reply = generateReplySchema.safeParse(await response.json().catch(() => undefined));
  if (!reply.success) throw new HostError(t("app.unreadable"));
  return reply.data;
}

/** What the app shows after a request, and what to open. */
export type RequestOutcome = {
  message: string;
  /** The workspace to open: the new tool's, once it is active. */
  openWorkspaceId?: string;
  /** A saved tool the request asked for: the person chooses Continue or Use again (GEN-18). */
  savedToolId?: string;
  dataChanged?: boolean;
  reloadData?: boolean;
  dataOffer?: Extract<GenerateReply, { kind: "data_confirmation" }> & { interfaceMessage?: string };
};

/** Keep verified interface facts when later entries are refused, cancelled or uncertain. */
export function withInterfaceOutcome(
  interfaceMessage: string | undefined,
  outcome: RequestOutcome,
  failure?: string,
): RequestOutcome {
  if (!interfaceMessage) return outcome;
  return {
    ...outcome,
    message: `${interfaceMessage} ${failure ? t("request.mixedEntryFailed", { reason: failure }) : outcome.message}`,
    ...(outcome.dataOffer ? { dataOffer: { ...outcome.dataOffer, interfaceMessage } } : {}),
  };
}

/** Data success is reported only after its transaction, never for a proposed patch. */
export function dataOutcome(reply: GenerateReply): RequestOutcome {
  if (reply.kind === "mixed_data") {
    const message =
      reply.interface.outcome === "updated"
        ? t("request.edited", { name: reply.name, summary: reply.interface.summary })
        : t("request.unchanged");
    return {
      ...withInterfaceOutcome(
        message,
        dataOutcome(reply.data),
        reply.data.kind === "failed" ? reply.data.message : undefined,
      ),
      openWorkspaceId: reply.workspaceId,
    };
  }
  if (reply.kind === "data_changed")
    return {
      message: t(reply.count === 1 ? "request.dataChangedOne" : "request.dataChanged", {
        name: reply.name,
        count: reply.count,
        summary: reply.summary,
      }),
      openWorkspaceId: reply.workspaceId,
      dataChanged: true,
    };
  if (reply.kind === "data_confirmation")
    return { message: t("request.dataReview"), dataOffer: reply };
  if (reply.kind === "answer") {
    switch (reply.answer) {
      case "data_unchanged":
        return { message: t("request.dataUnchanged") };
      case "data_cancelled":
        return { message: t("request.dataCancelled") };
      case "data_stale":
        return { message: t("request.dataStale") };
      case "data_clarify":
        return { message: t("request.dataClarify") };
      case "data_cannot":
        return { message: t("request.dataCannot", { reason: reply.reason ?? "" }) };
    }
  }
  return {
    message:
      reply.kind === "failed"
        ? t("request.failed", { message: reply.message })
        : t("request.failedPlain"),
  };
}

export type RequestDeps = {
  generate: (request: GenerateRequest) => Promise<GenerateReply>;
  repairSmoke: (request: SmokeRepairRequest) => Promise<GenerateReply>;
  finishData: (request: FinishDataRequest) => Promise<DataReply>;
  stage: (options: Parameters<typeof stageCandidate>[0]) => Promise<StagingResult>;
};

const defaultDeps: RequestDeps = {
  generate: (r) => askToGenerate(r),
  repairSmoke: (r) => askToRepairSmoke(r),
  finishData: (r) => askToFinishData(r),
  stage: stageCandidate,
};

async function stageRequest(
  reply: Extract<GenerateReply, { kind: "candidate" }>,
  deps: RequestDeps,
  control?: RequestControl,
): Promise<StagingResult> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  control?.controller.signal.addEventListener("abort", stop, { once: true });
  if (control?.stopped || Date.now() >= reply.activation.expiresAt) controller.abort();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(0, reply.activation.expiresAt - Date.now()),
  );
  try {
    return await deps.stage({
      candidate: {
        mountId: reply.mountId,
        hash: reply.hash,
        capabilities: reply.capabilities,
        syntheticData: reply.syntheticData,
      },
      workspaceId: reply.workspaceId,
      expectedDataRevision: reply.expectedDataRevision,
      activationToken: reply.activation.token,
      checks: [smokeCheck()],
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    control?.controller.signal.removeEventListener("abort", stop);
  }
}

/** Carries out a request from the chat, and says what happened in plain words (GEN-08). */
export async function carryOut(
  request: string,
  workspaceId: string | null,
  deps: RequestDeps = defaultDeps,
  onInterfaceApplied?: (workspaceId: string) => Promise<void>,
  control?: RequestControl,
): Promise<RequestOutcome> {
  const stopped = (): RequestOutcome => ({ message: t("request.stopped") });
  // A refusal the server made itself (under 500) started nothing, unlike a lost reply: after
  // Cancel it confirms the stop, and otherwise its own words say why.
  const refusal = (error: unknown): error is HostError =>
    error instanceof HostError && error.status !== undefined && error.status < 500;
  const reviewed = (outcome: RequestOutcome): RequestOutcome =>
    control?.stopped && outcome.dataOffer
      ? {
          ...withInterfaceOutcome(outcome.dataOffer.interfaceMessage, stopped()),
          openWorkspaceId: outcome.openWorkspaceId,
        }
      : outcome;
  const wait = <T>(pending: Promise<T>) => (control ? control.wait(pending) : pending);
  let reply: GenerateReply;
  let controlToken: string | undefined;
  try {
    controlToken = control ? await control.wait(control.start()) : undefined;
  } catch (error) {
    if (control?.stopped) return stopped();
    if (refusal(error)) throw error;
    // Generation is never sent without a registered control.
    return { message: t("request.failedPlain") };
  }
  if (control?.stopped) return stopped();
  try {
    reply = await wait(
      deps.generate({
        request,
        ...(workspaceId ? { workspaceId } : {}),
        ...(controlToken ? { controlToken } : {}),
      }),
    );
  } catch (error) {
    if (!control) throw error;
    if (refusal(error)) {
      if (control.stopped) return stopped();
      throw error;
    }
    return { message: t("request.requestUnknown"), reloadData: true };
  }
  let repaired = false;
  let mixed = false;
  for (;;) {
    switch (reply.kind) {
      case "data_changed":
      case "data_confirmation":
      case "mixed_data":
        return reviewed(dataOutcome(reply));
      case "candidate": {
        if (control?.stopped) return stopped();
        mixed ||= reply.dataPending === true;
        let staged: StagingResult;
        try {
          staged = await wait(stageRequest(reply, deps, control));
        } catch {
          // Activation may have committed before its response was lost (GEN-08, DATA-10).
          return { message: t("request.activationUnknown"), reloadData: true };
        }
        if (staged.outcome === "activated") {
          if (reply.dataPending) {
            const interfaceMessage = t("request.edited", {
              name: reply.name,
              summary: reply.summary,
            });
            try {
              await onInterfaceApplied?.(reply.workspaceId);
              if (control?.stopped)
                return {
                  ...withInterfaceOutcome(interfaceMessage, stopped()),
                  openWorkspaceId: reply.workspaceId,
                };
              return reviewed(
                dataOutcome({
                  kind: "mixed_data",
                  workspaceId: reply.workspaceId,
                  name: reply.name,
                  interface: { outcome: "updated", summary: reply.summary },
                  data: await wait(
                    deps.finishData({
                      workspaceId: reply.workspaceId,
                      hash: reply.hash,
                      token: reply.activation.token,
                    }),
                  ),
                }),
              );
            } catch (error) {
              if (refusal(error))
                return {
                  ...(control?.stopped
                    ? withInterfaceOutcome(interfaceMessage, stopped())
                    : withInterfaceOutcome(interfaceMessage, { message: "" }, error.message)),
                  openWorkspaceId: reply.workspaceId,
                };
              return {
                message: t("request.mixedUnknown", { interfaceMessage }),
                openWorkspaceId: reply.workspaceId,
                reloadData: true,
              };
            }
          }
          return {
            message: t(reply.operation === "edit" ? "request.edited" : "request.made", {
              name: reply.name,
              summary: reply.summary,
            }),
            openWorkspaceId: reply.workspaceId,
          };
        }
        if (control?.stopped) return stopped();
        if (Date.now() >= reply.activation.expiresAt) return { message: t("request.timedOut") };
        if (staged.outcome === "check-failed") {
          if (!repaired && (staged.check === "smoke" || staged.check === "start")) {
            repaired = true;
            try {
              reply = await wait(
                deps.repairSmoke({
                  workspaceId: reply.workspaceId,
                  hash: reply.hash,
                  token: reply.activation.token,
                  findings: [staged.reason],
                }),
              );
            } catch (error) {
              if (refusal(error)) {
                if (control?.stopped) return stopped();
                throw error;
              }
              return { message: t("request.requestUnknown"), reloadData: true };
            }
            continue;
          }
          return {
            message: t(
              reply.operation === "edit" ? "request.editCheckFailed" : "request.checkFailed",
            ),
          };
        }
        return { message: t("request.refused", { message: staged.message }) };
      }
      case "answer":
        switch (reply.answer) {
          case "clarify":
            return { message: t("request.clarify") };
          case "unsupported":
            return { message: t("request.unsupported") };
          case "cannot":
            return { message: t("request.cannot", { reason: reply.reason ?? "" }) };
          case "ask_to_split":
            return { message: t("request.split") };
          case "not_yet":
            return { message: t("request.notYet") };
          case "unchanged":
            return { message: t(mixed ? "request.mixedKept" : "request.unchanged") };
          case "stale":
            return { message: t("request.stale") };
          case "data_unchanged":
          case "data_cancelled":
          case "data_stale":
          case "data_clarify":
          case "data_cannot":
            return dataOutcome(reply);
        }
        break;
      case "open_saved":
        return { message: "", savedToolId: reply.savedToolId };
      case "failed":
        return { message: t("request.failed", { message: reply.message }) };
    }
    return { message: t("request.failedPlain") };
  }
}
