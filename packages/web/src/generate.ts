import {
  GENERATE_ROUTE,
  generateReplySchema,
  type GenerateReply,
  type GenerateRequest,
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
  const response = await send(GENERATE_ROUTE, {
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
};

export type RequestDeps = {
  generate: (request: GenerateRequest) => Promise<GenerateReply>;
  stage: (options: Parameters<typeof stageCandidate>[0]) => Promise<StagingResult>;
};

const defaultDeps: RequestDeps = { generate: (r) => askToGenerate(r), stage: stageCandidate };

/** Carries out a request from the chat, and says what happened in plain words (GEN-08). */
export async function carryOut(
  request: string,
  workspaceId: string | null,
  deps: RequestDeps = defaultDeps,
): Promise<RequestOutcome> {
  const reply = await deps.generate({ request, ...(workspaceId ? { workspaceId } : {}) });
  switch (reply.kind) {
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
          message: t("request.made", { name: reply.name, summary: reply.summary }),
          openWorkspaceId: reply.workspaceId,
        };
      }
      if (staged.outcome === "check-failed") return { message: t("request.checkFailed") };
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
      }
      break;
    case "open_saved":
      return { message: "", savedToolId: reply.savedToolId };
    case "failed":
      return { message: t("request.failed", { message: reply.message }) };
  }
  return { message: t("request.failedPlain") };
}
