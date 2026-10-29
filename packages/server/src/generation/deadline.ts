import type { Usage } from "@tessera/contracts";
import { ProviderError, type Provider } from "../providers/index.ts";

/** The server's total stage budget, shared with a later smoke repair (GEN-11). */
export const REQUEST_TIME_LIMIT_MS = 7 * 60_000;
const TIMED_OUT = "The request took too long. Please try again.";

/** Bounds a request's calls without releasing its queue slot before the provider has stopped. */
export async function withinRequestDeadline<T>(
  provider: Provider,
  expires: number,
  work: (bounded: Provider, signal: AbortSignal, check: () => void) => Promise<T>,
  parent: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  const check = (usage?: Usage) => {
    if (controller.signal.aborted || Date.now() >= expires)
      throw new ProviderError("time_limit", TIMED_OUT, usage);
    if (parent.aborted) throw new ProviderError("cancelled", "The request was stopped.", usage);
  };
  check();
  const timer = setTimeout(() => controller.abort(), expires - Date.now());
  const bounded: Provider = {
    name: provider.name,
    live: provider.live,
    async run(spec) {
      check();
      const remaining = expires - Date.now();
      if (remaining <= 0) throw new ProviderError("time_limit", TIMED_OUT);
      const result = await provider.run({
        ...spec,
        timeLimitMs: Math.min(spec.timeLimitMs, remaining),
        signal: AbortSignal.any([signal, ...(spec.signal ? [spec.signal] : [])]),
      });
      // Even a provider that completes late cannot hand an answer to code that stores it.
      check(result.usage);
      return result;
    },
  };
  try {
    const result = await work(bounded, signal, check);
    check();
    return result;
  } catch (error) {
    if (controller.signal.aborted || Date.now() >= expires) {
      throw new ProviderError(
        "time_limit",
        TIMED_OUT,
        error instanceof ProviderError ? error.usage : undefined,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
