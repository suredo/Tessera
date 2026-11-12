import type { Intent, SmokeRepairRequest } from "@tessera/contracts";
import type { GenerationResult } from "./result.ts";
import { canonicalJson, creationSchema } from "@tessera/contracts";
import { candidateMount } from "../host/index.ts";
import type { RepairClass } from "../prompts/index.ts";
import type { Provider, Routes } from "../providers/index.ts";
import { loadVersion, saveVersion } from "../versions/index.ts";
import { getWorkspace, type Store } from "../workspaces/index.ts";
import { createTool } from "./create.ts";
import { editTool } from "./edit.ts";
import type { TwoPassPlan } from "./two-pass.ts";
import { DEFAULT_STAGE_TIME_LIMITS, type StageTimeLimits } from "./time-limits.ts";

/** Server-owned continuation of creation or editing, never supplied by the browser (GEN-09). */
export type SmokeRepairContext = {
  reply: Extract<GenerationResult, { kind: "candidate" }>;
  request: string;
  intent: Intent;
  repairUsage: Partial<Record<RepairClass, number>>;
  /** Null for creation; the still-active original version for an edit. */
  baseVersion: string | null;
  /** Isolated from the edit stage; only planned after this candidate activates. */
  dataPart?: string;
  /** The answer of the discussion a mixed request followed, for its entry part (GEN-19). */
  discussed?: string;
  /** A big new tool's core pass: its repair keeps to the core, and the rest comes later (GEN-17). */
  plan?: TwoPassPlan;
};

/** Repairs a stored candidate; its workspace's starting data is never installed again (GEN-05). */
export async function repairSmoke(
  store: Store,
  provider: Provider,
  routes: Routes,
  input: Omit<SmokeRepairRequest, "token">,
  context: SmokeRepairContext | undefined,
  signal?: AbortSignal,
  beforeStore: () => void = () => signal?.throwIfAborted(),
  limits: StageTimeLimits = DEFAULT_STAGE_TIME_LIMITS,
): Promise<GenerationResult> {
  const failed = (findings: string[]): GenerationResult => ({
    kind: "failed",
    failure: "smoke",
    message: "The tool couldn't be repaired. Nothing was changed.",
    findings,
  });
  if (!context) return failed(["This candidate has no smoke repair left."]);
  const current = () => {
    const workspace = getWorkspace(store, input.workspaceId);
    return (
      workspace?.currentVersion === context.baseVersion &&
      workspace.dataRevision === context.reply.expectedDataRevision
    );
  };
  if (!current()) return failed(["The workspace changed before repair."]);
  const stored = loadVersion(store.db, input.hash);
  if (stored?.kind !== "ok") return failed(["The failed tool couldn't be read."]);
  const artifact = stored.artifact;
  const original = context.baseVersion ? loadVersion(store.db, context.baseVersion) : undefined;
  const workspace = getWorkspace(store, input.workspaceId);
  if (context.baseVersion && (original?.kind !== "ok" || !workspace?.data))
    return failed(["The original tool couldn't be read."]);
  const repaired =
    context.baseVersion && original?.kind === "ok" && workspace?.data
      ? await editTool(provider, routes, {
          request: context.request,
          intent: context.intent,
          signal,
          repairUsage: context.repairUsage,
          timeLimits: limits,
          artifact: original.artifact,
          data: workspace.data,
          repair: {
            failure: input.failure ?? "smoke",
            diagnostics: input.findings,
            attempt: {
              outcome: "edit",
              summary: context.reply.summary,
              ...(context.reply.leftOut ? { leftOut: context.reply.leftOut } : {}),
              files: context.intent?.lookOnly
                ? { mode: "style", css: artifact.code.css }
                : { mode: "replace", code: artifact.code },
              data:
                canonicalJson(artifact.data) === canonicalJson(original.artifact.data)
                  ? { mode: "unchanged" }
                  : {
                      mode: "migrate",
                      schema: artifact.data.schema,
                      defaults: artifact.data.defaults,
                      migration: artifact.data.migrations.at(-1)!,
                    },
            },
          },
        })
      : await createTool(provider, routes, {
          request: context.request,
          intent: context.intent,
          signal,
          repairUsage: context.repairUsage,
          timeLimits: limits,
          ...(context.plan ? { core: context.plan } : {}),
          // The repair must still pass the checks from the request the candidate was told (VER-09).
          ...(context.reply.acceptance ? { acceptance: context.reply.acceptance } : {}),
          repair: {
            failure: input.failure ?? "smoke",
            diagnostics: input.findings,
            attempt: {
              outcome: "tool",
              name: context.reply.name,
              summary: context.reply.summary,
              ...(context.reply.leftOut ? { leftOut: context.reply.leftOut } : {}),
              code: artifact.code,
              data: {
                schema: artifact.data.schema,
                reusableDefaults: artifact.data.defaults,
                initialState: {},
              },
              capabilities: creationSchema.options[0].shape.capabilities.parse(
                artifact.capabilities,
              ),
              uiMode: artifact.ui.mode,
            },
          },
        });
  if (repaired.kind === "unchanged") return { kind: "answer", answer: "unchanged" };
  if (repaired.kind === "cannot")
    // The model's own words, when the plain reason replaced them, stay for the details (GEN-10).
    return {
      kind: "answer",
      answer: "cannot",
      reason: repaired.reason,
      ...(repaired.detail ? { findings: [repaired.detail] } : {}),
    };
  if (repaired.kind === "failed")
    return {
      kind: "failed",
      failure: repaired.failure,
      message:
        repaired.failure === "provider"
          ? repaired.findings[0]!
          : "The tool couldn't be repaired. Nothing was changed.",
      findings: repaired.findings,
    };
  // Smoke repair changes code, not the data contract or the already-installed entries. Refuse
  // a changed declaration rather than silently migrating or replacing the person's data.
  if (canonicalJson(repaired.artifact.data) !== canonicalJson(artifact.data)) {
    return failed(["Smoke repair changed the tool's data declaration."]);
  }
  if (!current()) return failed(["The workspace changed during repair."]);
  beforeStore();
  const hash = saveVersion(store.db, repaired.artifact);
  // What the repaired answer leaves out replaces what the failed one did (GEN-08).
  const reply = { ...context.reply };
  delete reply.leftOut;
  return {
    ...reply,
    ...(repaired.leftOut ? { leftOut: repaired.leftOut } : {}),
    hash,
    mountId: candidateMount(hash),
    capabilities: repaired.artifact.capabilities,
    syntheticData: repaired.artifact.data.defaults,
    name: context.reply.name,
    summary: repaired.summary,
  };
}
