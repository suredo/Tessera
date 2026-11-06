// Docs: docs/code/server/ledger.md
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GenerateReply, Usage } from "@tessera/contracts";
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
  started_at: z.string(),
  duration_ms: z.number().nullable(),
  input_tokens: z.number().nullable(),
  cached_input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  outcome: z.enum(["ok", "failed", "crashed"]),
  error: z.string().nullable(),
  message: z.string().nullable(),
  detail: z.string().nullable(),
});

/** One model call as the ledger keeps it. `null` usage is unknown, never 0 (CLI-04). */
export type LedgerCall = {
  index: number;
  stage: string;
  provider: string;
  model: string;
  effort: string;
  promptChars: number;
  systemChars: number;
  promptParts: string[];
  startedAt: string;
  durationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  outcome: "ok" | "failed" | "crashed";
  /** For a failure: its kind, the plain message, and what the provider itself said. */
  error: string | null;
  message: string | null;
  detail: string | null;
};

/** One request as the ledger keeps it, with its calls in order. */
export type LedgerRequest = {
  id: string;
  workspaceId: string | null;
  kind: RequestKind;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
  message: string | null;
  findings: string[];
  calls: LedgerCall[];
};

type Failure = { error?: string; message?: string; detail?: string };

const strings = z.array(z.string());

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
        const write = (usage: Usage, outcome: LedgerCall["outcome"], failure: Failure = {}) =>
          this.#safely(() =>
            this.#store.db.run(
              // Numbered in the order the calls end, across every wrapper of the request.
              `INSERT INTO request_calls (request_id, call_index, stage, provider, model, effort,
                 prompt_chars, system_chars, prompt_parts, started_at, duration_ms, input_tokens,
                 cached_input_tokens, output_tokens, outcome, error, message, detail)
               SELECT ?1, COALESCE(MAX(call_index) + 1, 0), ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                 ?11, ?12, ?13, ?14, ?15, ?16, ?17
               FROM request_calls WHERE request_id = ?1`,
              id,
              spec.stage,
              provider.name,
              spec.model,
              spec.effort,
              spec.prompt.length,
              spec.system.length,
              JSON.stringify(spec.promptParts ?? []),
              startedAt,
              usage.durationMs,
              usage.inputTokens,
              usage.cachedInputTokens,
              usage.outputTokens,
              outcome,
              failure.error ?? null,
              failure.message ?? null,
              failure.detail ?? null,
            ),
          );
        try {
          const result = await provider.run(spec);
          write(result.usage, "ok");
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

  /** Records how the request ended: the reply's kind, its message and findings, and its workspace. */
  finish(id: string, reply: GenerateReply): void {
    this.#safely(() => {
      this.#store.db.run(
        "UPDATE requests SET ended_at = ?, outcome = ?, message = ?, findings = ? WHERE id = ?",
        this.#store.now().toISOString(),
        reply.kind,
        "message" in reply && typeof reply.message === "string" ? reply.message : null,
        JSON.stringify("findings" in reply ? reply.findings : []),
        id,
      );
      if ("workspaceId" in reply && typeof reply.workspaceId === "string")
        this.#attach(id, reply.workspaceId);
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
        startedAt: c.started_at,
        durationMs: c.duration_ms,
        inputTokens: c.input_tokens,
        cachedInputTokens: c.cached_input_tokens,
        outputTokens: c.output_tokens,
        outcome: c.outcome,
        error: c.error,
        message: c.message,
        detail: c.detail,
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
