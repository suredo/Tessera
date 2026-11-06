import { randomUUID } from "node:crypto";
import type { RequestProgress, Stage } from "@tessera/contracts";
import type { Provider } from "../providers/index.ts";
import { ProviderError } from "../providers/index.ts";
import type { JobQueue } from "../jobs/index.ts";
import { REQUEST_TIME_LIMIT_MS } from "./deadline.ts";

type Control = {
  controller: AbortController;
  claimed: boolean;
  expires: number;
  jobs: Set<string>;
  tokens: Set<string>;
  /** When the request was sent, and the stage it is in now (GEN-16): none between its parts. */
  sent?: number;
  stage?: "waiting" | Stage;
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

  /** Where the request registered as `token` stands, for its progress display (GEN-16). */
  progress(token: string): RequestProgress {
    const control = this.#entries.get(token);
    if (!control?.stage || control.sent === undefined || control.controller.signal.aborted)
      return { stage: null, seconds: 0 };
    return {
      stage: control.stage,
      seconds: Math.max(0, Math.floor((Date.now() - control.sent) / 1000)),
    };
  }

  /** Marks the request as sent and waiting for its turn in the queue. */
  waiting(control: Control | undefined): void {
    if (!control) return;
    control.sent ??= Date.now();
    control.stage = "waiting";
  }

  /** The request's part is over: no stage until its next part starts. */
  idle(control: Control | undefined): void {
    if (control) control.stage = undefined;
  }

  /** The provider, telling the request's progress which stage each call runs (GEN-16). */
  watch(control: Control | undefined, provider: Provider): Provider {
    if (!control) return provider;
    return {
      name: provider.name,
      live: provider.live,
      run: (spec) => {
        control.sent ??= Date.now();
        control.stage = spec.stage;
        return provider.run(spec);
      },
    };
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
