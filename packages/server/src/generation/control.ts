import { randomUUID } from "node:crypto";
import { ProviderError } from "../providers/index.ts";
import type { JobQueue } from "../jobs/index.ts";
import { REQUEST_TIME_LIMIT_MS } from "./deadline.ts";

type Control = {
  controller: AbortController;
  claimed: boolean;
  expires: number;
  jobs: Set<string>;
  tokens: Set<string>;
};

/** Bounded, host-minted cancellation capabilities. Continuations inherit ownership by identity. */
export class RequestControls {
  readonly #entries = new Map<string, Control>();
  readonly #owners = new Map<string, Control>();
  readonly #jobs: JobQueue;
  readonly #revoke: (token: string) => void;
  constructor(jobs: JobQueue, revoke: (token: string) => void) {
    this.#jobs = jobs;
    this.#revoke = revoke;
  }

  register(): string | undefined {
    for (const [token, control] of this.#entries) {
      if (control.expires > Date.now()) continue;
      this.#stop(control);
      for (const owned of control.tokens) this.#owners.delete(owned);
      this.#entries.delete(token);
    }
    if (this.#entries.size >= 100) return undefined;
    const token = randomUUID();
    this.#entries.set(token, {
      controller: new AbortController(),
      claimed: false,
      expires: Date.now() + REQUEST_TIME_LIMIT_MS,
      jobs: new Set(),
      tokens: new Set(),
    });
    return token;
  }

  claim(token: string): Control {
    const control = this.#entries.get(token);
    this.check(control);
    if (control!.claimed) throw new ProviderError("cancelled", "This request was already sent.");
    control!.claimed = true;
    return control!;
  }

  owner(token: string): Control | undefined {
    return this.#owners.get(token);
  }

  check(control: Control | undefined): void {
    if (!control || control.controller.signal.aborted || control.expires <= Date.now())
      throw new ProviderError("cancelled", "The request was stopped or expired. Please ask again.");
  }

  bind(control: Control | undefined, token: string): void {
    if (!control) return;
    control.tokens.add(token);
    this.#owners.set(token, control);
  }

  cancel(token: string): boolean {
    const control = this.#entries.get(token);
    if (!control || control.expires <= Date.now()) return false;
    this.#stop(control);
    return true;
  }

  #stop(control: Control) {
    control.controller.abort();
    for (const id of control.jobs) this.#jobs.cancel(id);
    for (const token of control.tokens) this.#revoke(token);
  }
}
