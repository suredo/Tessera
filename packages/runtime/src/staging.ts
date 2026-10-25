import type { ActivationRefusal, BridgeResult, JsonValue, Workspace } from "@tessera/contracts";
import { BridgeError, serveBridge, type DataHandlers } from "./bridge.ts";
import type { CheckOutcome, VerificationCheck } from "./checks.ts";
import { mountTool, type WatchdogOptions } from "./host.ts";
import { serverActivation, type Activate } from "./server-activation.ts";

// Staging before activation (RUN-03): a candidate first runs in a hidden panel against synthetic
// data, where it can't write (BRG-06), and its checks judge it there. Only when every check passes
// does the host ask the server to activate it (DATA-10). A failed check activates nothing, so the
// previous version stays, with the person's data untouched. The panel always goes afterwards.

/** A tool version waiting to be activated. */
export type Candidate = {
  /** Where the server serves its code (`/runtime/tool?mount=…`). */
  mountId: string;
  /** Its stored version's name, which the server activates. */
  hash: string;
  /** The capabilities its version declares (CAP-01). */
  capabilities: readonly string[];
  /** What it runs against in the panel: its reusable defaults, never the person's data. */
  syntheticData: Record<string, JsonValue>;
};

export type StagingOptions = {
  candidate: Candidate;
  workspaceId: string;
  /** The data revision the activation is planned against (MIG-06). */
  expectedDataRevision: number;
  /** Run in order; the first to fail ends staging. */
  checks: readonly VerificationCheck[];
  /** How to activate; the server's activation route by default. */
  activate?: Activate;
  /** The page the panel goes into; this document by default. */
  document?: Document;
  appLocation?: { protocol: string; port: string };
  watchdog?: WatchdogOptions;
  signal?: AbortSignal;
};

export type StagingResult =
  | { outcome: "activated"; workspace: Workspace; migrationCount: number }
  | { outcome: "check-failed"; check: string; reason: string }
  | { outcome: "refused"; reason: ActivationRefusal; message: string };

// Every record in the synthetic data is at its first revision.
function syntheticRead(data: Record<string, JsonValue>): BridgeResult<"data.read"> {
  const revisions: Record<string, Record<string, number>> = {};
  for (const [collection, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    for (const record of list) {
      const id =
        typeof record === "object" && record !== null && !Array.isArray(record)
          ? record["id"]
          : undefined;
      if (typeof id !== "string") continue;
      (revisions[collection] ??= {})[id] = 1;
    }
  }
  return { data, revisions };
}

const syntheticData = (data: Record<string, JsonValue>): DataHandlers => ({
  read: () => Promise.resolve(syntheticRead(data)),
  // The bridge refuses a write in the staging phase before it gets here; this is a second wall.
  patch: () => Promise.reject(new BridgeError("not-active", "A tool being checked can't save.")),
});

// Hidden from sight, assistive technology and input, but laid out, so a check can measure it.
function hiddenPanel(doc: Document): HTMLElement {
  const panel = doc.createElement("div");
  panel.dataset["tessera"] = "staging";
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;
  Object.assign(panel.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "320px",
    height: "640px",
    overflow: "hidden",
    pointerEvents: "none",
  });
  doc.body.append(panel);
  return panel;
}

/**
 * Stages `candidate`: mounts it in a hidden panel against its synthetic data, runs `checks`, and
 * activates it only if all of them pass. Resolves with what happened; rejects only when the
 * activation itself can't be asked, such as the server being unreachable.
 */
export async function stageCandidate(options: StagingOptions): Promise<StagingResult> {
  const { candidate } = options;
  const panel = hiddenPanel(options.document ?? document);
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop);
  let verdict: { check: string; outcome: CheckOutcome } | undefined;
  try {
    let tool;
    try {
      tool = await mountTool(
        panel,
        candidate.mountId,
        options.appLocation,
        controller.signal,
        options.watchdog,
      );
    } catch (error) {
      verdict = { check: "start", outcome: { ok: false, reason: (error as Error).message } };
    }
    if (tool) {
      const bridge = serveBridge(tool, {
        capabilities: candidate.capabilities,
        data: syntheticData(candidate.syntheticData),
        staging: true,
      });
      try {
        for (const check of options.checks) {
          // A check that breaks is a check that didn't pass: the candidate isn't activated.
          const outcome = await check
            .run({ tool, panel, signal: controller.signal })
            .catch((error: unknown): CheckOutcome => ({
              ok: false,
              reason: error instanceof Error ? error.message : "The check broke.",
            }));
          if (!outcome.ok) {
            verdict = { check: check.name, outcome };
            break;
          }
        }
      } finally {
        bridge.stop();
        tool.unmount();
      }
    }
  } finally {
    controller.abort();
    options.signal?.removeEventListener("abort", stop);
    panel.remove();
  }
  if (verdict && !verdict.outcome.ok) {
    return { outcome: "check-failed", check: verdict.check, reason: verdict.outcome.reason };
  }
  if (options.signal?.aborted) {
    return { outcome: "check-failed", check: "cancelled", reason: "Staging was cancelled." };
  }
  const activate = options.activate ?? serverActivation();
  const reply = await activate({
    workspaceId: options.workspaceId,
    hash: candidate.hash,
    expectedDataRevision: options.expectedDataRevision,
  });
  return reply.ok
    ? { outcome: "activated", workspace: reply.workspace, migrationCount: reply.migrationCount }
    : { outcome: "refused", reason: reply.reason, message: reply.message };
}
