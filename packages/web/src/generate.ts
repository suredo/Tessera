import {
  GENERATE_ROUTE,
  SMOKE_REPAIR_ROUTE,
  CONFIRM_DATA_ROUTE,
  generateReplySchema,
  type GenerateReply,
  type GenerateRequest,
  type SmokeRepairRequest,
  type ConfirmDataRequest,
} from "@tessera/contracts";
import { smokeCheck, stageCandidate, type StagingResult } from "@tessera/runtime";
import { HostError, type Send } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

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

async function askForCandidate(
  route: string,
  request: GenerateRequest | SmokeRepairRequest | ConfirmDataRequest,
  send: Send,
): Promise<GenerateReply> {
  const response = await send(route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const said = await response.text().catch(() => "");
    throw new HostError(said && response.status < 500 ? said : t("request.failedPlain"));
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
  dataOffer?: Extract<GenerateReply, { kind: "data_confirmation" }>;
};

/** Data success is reported only after its transaction, never for a proposed patch. */
export function dataOutcome(reply: GenerateReply): RequestOutcome {
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
  stage: (options: Parameters<typeof stageCandidate>[0]) => Promise<StagingResult>;
};

const defaultDeps: RequestDeps = {
  generate: (r) => askToGenerate(r),
  repairSmoke: (r) => askToRepairSmoke(r),
  stage: stageCandidate,
};

/** Carries out a request from the chat, and says what happened in plain words (GEN-08). */
export async function carryOut(
  request: string,
  workspaceId: string | null,
  deps: RequestDeps = defaultDeps,
): Promise<RequestOutcome> {
  let reply = await deps.generate({ request, ...(workspaceId ? { workspaceId } : {}) });
  let repaired = false;
  for (;;) {
    switch (reply.kind) {
      case "data_changed":
      case "data_confirmation":
        return dataOutcome(reply);
      case "candidate": {
        const staged = await deps.stage({
          candidate: {
            mountId: reply.mountId,
            hash: reply.hash,
            capabilities: reply.capabilities,
            syntheticData: reply.syntheticData,
          },
          workspaceId: reply.workspaceId,
          expectedDataRevision: reply.expectedDataRevision,
          checks: [smokeCheck()],
        });
        if (staged.outcome === "activated") {
          return {
            message: t(reply.operation === "edit" ? "request.edited" : "request.made", {
              name: reply.name,
              summary: reply.summary,
            }),
            openWorkspaceId: reply.workspaceId,
          };
        }
        if (staged.outcome === "check-failed") {
          if (!repaired && (staged.check === "smoke" || staged.check === "start")) {
            repaired = true;
            reply = await deps.repairSmoke({
              workspaceId: reply.workspaceId,
              hash: reply.hash,
              findings: [staged.reason],
            });
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
            return { message: t("request.unchanged") };
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
