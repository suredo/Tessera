// Docs: docs/code/server/ledger.md
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ledgerCallSchema,
  type GenerateReply,
  type LedgerCall,
  type LedgerRequest,
  type Usage,
} from "@tessera/contracts";
import { ProviderError, UNKNOWN_USAGE, type Provider } from "../providers/index.ts";
import type { Store } from "../workspaces/index.ts";

// The call ledger (OBS-01, GEN-10): each request the host carries out, how it ended and why, and
// each model call it made. It is only a record: a write that fails is reported to `onError` and
// never stops or changes the request. What the person asked isn't kept, only its size.

/** How many requests with no workspace are kept; older ones go. One with a workspace goes with it. */
export const UNATTACHED_REQUESTS_KEPT = 500;

export type RequestKind = "generate" | "repair" | "data";

const requestRow = z.object({
  id: z.string(),
  workspace_id: z.string().nullable(),
  kind: z.enum(["generate", "repair", "data"]),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  outcome: z.string().nullable(),
  message: z.string().nullable(),
  findings: z.string(),
});
const callRow = z.object({
  call_index: z.number(),
  stage: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.string(),
  prompt_chars: z.number(),
  system_chars: z.number(),
  prompt_parts: z.string(),
  diagnostics: z.string(),
  started_at: z.string(),
  duration_ms: z.number().nullable(),
  input_tokens: z.number().nullable(),
  cached_input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  outcome: z.enum(["ok", "failed", "crashed"]),
  error: z.string().nullable(),
  message: z.string().nullable(),
  detail: z.string().nullable(),
  code: z.string().nullable(),
});

type Failure = { error?: string; message?: string; detail?: string };
type Code = NonNullable<LedgerCall["code"]>;

/** The most code a call keeps, in characters; a larger answer keeps none rather than a part. */
export const CALL_CODE_LIMIT = 256 * 1024;

/**
 * The code an answer holds (GEN-10): a created tool's, an edit's replaced code, or a style edit's
 * CSS. Only the code, so neither the person's request nor the entries it gives are kept.
 */
export function answerCode(value: unknown): Code | null {
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!record(value)) return null;
  const files = record(value["files"]) ? value["files"] : undefined;
  const code = record(value["code"])
    ? value["code"]
    : record(files?.["code"])
      ? files["code"]
      : undefined;
  const picked: Code = {};
  for (const part of ["html", "css", "js"] as const)
    if (typeof code?.[part] === "string") picked[part] = code[part];
  if (!code && typeof files?.["css"] === "string") picked.css = files["css"];
  return Object.keys(picked).length > 0 ? picked : null;
}

const strings = z.array(z.string());
const codeSchema = ledgerCallSchema.shape.code;

export class RequestLedger {
  readonly #store: Store;
  readonly #onError: (error: unknown) => void;
  constructor(store: Store, onError: (error: unknown) => void = (e) => console.error(e)) {
    this.#store = store;
    this.#onError = onError;
  }

  /** Starts a request's record, for the workspace it acts on when one is known; returns its ID. */
  start(kind: RequestKind, workspaceId?: string): string {
    const id = randomUUID();
    this.#safely(() => {
      this.#store.db.run(
        "INSERT INTO requests (id, kind, started_at) VALUES (?, ?, ?)",
        id,
        kind,
        this.#store.now().toISOString(),
      );
      if (workspaceId) this.#attach(id, workspaceId);
    });
    return id;
  }

  /** The provider, recording each call it makes for the request `id` (OBS-01). */
  record(id: string, provider: Provider): Provider {
    return {
      name: provider.name,
      live: provider.live,
      run: async (spec) => {
        const startedAt = this.#store.now().toISOString();
        const write = (
          usage: Usage,
          outcome: LedgerCall["outcome"],
          failure: Failure = {},
          code: Code | null = null,
        ) =>
          this.#safely(() =>
            this.#store.db.run(
              // Numbered in the order the calls end, across every wrapper of the request.
              `INSERT INTO request_calls (request_id, call_index, stage, provider, model, effort,
                 prompt_chars, system_chars, prompt_parts, diagnostics, started_at, duration_ms,
                 input_tokens, cached_input_tokens, output_tokens, outcome, error, message, detail,
                 code)
               SELECT ?1, COALESCE(MAX(call_index) + 1, 0), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                 ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
               FROM request_calls WHERE request_id = ?1`,
              id,
              spec.stage,
              provider.name,
              spec.model,
              spec.effort,
              spec.prompt.length,
              spec.system.length,
              JSON.stringify(spec.promptParts ?? []),
              JSON.stringify(spec.diagnostics ?? []),
              startedAt,
              usage.durationMs,
              usage.inputTokens,
              usage.cachedInputTokens,
              usage.outputTokens,
              outcome,
              failure.error ?? null,
              failure.message ?? null,
              failure.detail ?? null,
              code && JSON.stringify(code).length <= CALL_CODE_LIMIT ? JSON.stringify(code) : null,
            ),
          );
        try {
          const result = await provider.run(spec);
          write(result.usage, "ok", {}, answerCode(result.value));
          return result;
        } catch (error) {
          if (error instanceof ProviderError) {
            write(error.usage, "failed", {
              error: error.kind,
              message: error.message,
              detail: error.detail,
            });
          } else {
            const message = error instanceof Error ? error.message : String(error);
            write(UNKNOWN_USAGE, "crashed", { message });
          }
          throw error;
        }
      },
    };
  }

  /**
   * Records how the request ended: the reply's kind, its message and findings, and its workspace.
   * A mixed request's entry part can fail after its interface part is done, so its outcome, message
   * and findings are the ones kept (GEN-10).
   */
  finish(id: string, reply: GenerateReply): void {
    this.#safely(() => {
      const told = reply.kind === "mixed_data" ? reply.data : reply;
      const outcome = reply.kind === "mixed_data" ? `mixed_data:${reply.data.kind}` : reply.kind;
      const message =
        "message" in told ? told.message : "reason" in told ? (told.reason ?? null) : null;
      this.#store.db.run(
        "UPDATE requests SET ended_at = ?, outcome = ?, message = ?, findings = ? WHERE id = ?",
        this.#store.now().toISOString(),
        outcome,
        message,
        JSON.stringify("findings" in told ? told.findings : []),
        id,
      );
      if ("workspaceId" in reply) this.#attach(id, reply.workspaceId);
      this.#prune();
    });
  }

  /** A workspace's requests, newest first, each with its calls (OBS-01: per workspace). */
  forWorkspace(workspaceId: string, limit = 50): LedgerRequest[] {
    return this.#store.db
      .all(
        requestRow,
        "SELECT * FROM requests WHERE workspace_id = ? ORDER BY rowid DESC LIMIT ?",
        workspaceId,
        limit,
      )
      .map((row) => this.#request(row));
  }

  /** The newest requests that made no workspace, such as a failed creation (GEN-10). */
  unattached(limit = 50): LedgerRequest[] {
    return this.#store.db
      .all(
        requestRow,
        "SELECT * FROM requests WHERE workspace_id IS NULL ORDER BY rowid DESC LIMIT ?",
        limit,
      )
      .map((row) => this.#request(row));
  }

  /** One request, with its calls (OBS-01: per request). */
  request(id: string): LedgerRequest | undefined {
    const row = this.#store.db.get(requestRow, "SELECT * FROM requests WHERE id = ?", id);
    return row && this.#request(row);
  }

  #request(row: z.infer<typeof requestRow>): LedgerRequest {
    const calls = this.#store.db.all(
      callRow,
      "SELECT * FROM request_calls WHERE request_id = ? ORDER BY call_index",
      row.id,
    );
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      kind: row.kind,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      outcome: row.outcome,
      message: row.message,
      findings: strings.parse(JSON.parse(row.findings)),
      calls: calls.map((c) => ({
        index: c.call_index,
        stage: c.stage,
        provider: c.provider,
        model: c.model,
        effort: c.effort,
        promptChars: c.prompt_chars,
        systemChars: c.system_chars,
        promptParts: strings.parse(JSON.parse(c.prompt_parts)),
        diagnostics: strings.parse(JSON.parse(c.diagnostics)),
        startedAt: c.started_at,
        durationMs: c.duration_ms,
        inputTokens: c.input_tokens,
        cachedInputTokens: c.cached_input_tokens,
        outputTokens: c.output_tokens,
        outcome: c.outcome,
        error: c.error,
        message: c.message,
        detail: c.detail,
        code: c.code === null ? null : codeSchema.parse(JSON.parse(c.code)),
      })),
    };
  }

  /** Attaches the request to a workspace that exists; an unknown one leaves it unattached. */
  #attach(id: string, workspaceId: string) {
    this.#store.db.run(
      `UPDATE requests SET workspace_id = ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM workspaces WHERE id = ?)`,
      workspaceId,
      id,
      workspaceId,
    );
  }

  /** Drops the oldest requests that have no workspace, past the newest few hundred. */
  #prune() {
    this.#store.db.run(
      `DELETE FROM requests WHERE workspace_id IS NULL AND rowid NOT IN
         (SELECT rowid FROM requests WHERE workspace_id IS NULL ORDER BY rowid DESC LIMIT ?)`,
      UNATTACHED_REQUESTS_KEPT,
    );
  }

  #safely(work: () => void) {
    try {
      work();
    } catch (error) {
      this.#onError(error);
    }
  }
}
