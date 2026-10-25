import type { ActivationRefusal, BridgeResult, JsonValue, Workspace } from "@tessera/contracts";
import { BridgeError, serveBridge, type DataHandlers } from "./bridge.ts";
import type { CheckContext, CheckOutcome, VerificationCheck } from "./checks.ts";
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

// Hidden from sight, assistive technology and input, but laid out at the UI standard's narrow
// width, so a check can measure it.
const PANEL = { width: "320px", height: "640px" };

function hiddenPanel(doc: Document): HTMLElement {
  const panel = doc.createElement("div");
  panel.dataset["tessera"] = "staging";
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;
  Object.assign(panel.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    ...PANEL,
    overflow: "hidden",
    pointerEvents: "none",
  });
  doc.body.append(panel);
  return panel;
}

// The candidate's frame fills the panel from the moment it's inserted, before the wrapper loads,
// so the candidate starts at the panel's width rather than a frame's default of 300 by 150. Set
// through the frame's own style, which a host page's CSP can't block as it could a <style> element.
function fillPanel(panel: HTMLElement): MutationObserver {
  const fill = (node: Node) => {
    if (node instanceof HTMLIFrameElement) {
      Object.assign(node.style, { border: "0", display: "block", ...PANEL });
    }
  };
  const observer = new MutationObserver((changes) =>
    changes.forEach((change) => change.addedNodes.forEach(fill)),
  );
  observer.observe(panel, { childList: true });
  return observer;
}

const CANCELLED = { ok: false, reason: "Staging was cancelled." } as const satisfies CheckOutcome;

// Runs one check. One that throws, at once or later, didn't pass; and cancelling stops the wait
// even for a check that never looks at its signal.
async function runCheck(check: VerificationCheck, context: CheckContext): Promise<CheckOutcome> {
  const cancelled = new Promise<CheckOutcome>((resolve) => {
    if (context.signal.aborted) resolve(CANCELLED);
    context.signal.addEventListener("abort", () => resolve(CANCELLED), { once: true });
  });
  try {
    return await Promise.race([check.run(context), cancelled]);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The check broke." };
  }
}

/**
 * Stages `candidate`: mounts it in a hidden panel against its synthetic data, runs `checks`, and
 * activates it only if all of them pass. Resolves with what happened; rejects only when the
 * activation itself can't be asked, such as the server being unreachable.
 */
export async function stageCandidate(options: StagingOptions): Promise<StagingResult> {
  const { candidate } = options;
  // Cancelled before it began: nothing is mounted, and nothing activated.
  if (options.signal?.aborted) {
    return { outcome: "check-failed", check: "cancelled", reason: CANCELLED.reason };
  }
  const panel = hiddenPanel(options.document ?? document);
  const sizing = fillPanel(panel);
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
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
          const outcome = await runCheck(check, { tool, panel, signal: controller.signal });
          if (!outcome.ok) {
            verdict = { check: outcome === CANCELLED ? "cancelled" : check.name, outcome };
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
    sizing.disconnect();
    panel.remove();
  }
  if (options.signal?.aborted) {
    return { outcome: "check-failed", check: "cancelled", reason: CANCELLED.reason };
  }
  if (verdict && !verdict.outcome.ok) {
    return { outcome: "check-failed", check: verdict.check, reason: verdict.outcome.reason };
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
