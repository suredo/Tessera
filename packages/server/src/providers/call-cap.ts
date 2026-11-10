import { ProviderError, type Provider, type StageResult, type StageSpec } from "./provider.ts";

// A hard cap on model calls for a Tessera started for an evaluation outside the harness, such as
// the clean-setup scenario P1 in Windows Sandbox (ENG-07). Every provider it wraps draws on the
// same count, whichever program it is, so the cap covers a whole run. A call past the cap never
// reaches the provider: it fails as a usage limit, which ends its request without a repair.

/** Counts calls across every provider it wraps, and refuses any past the cap. */
export type CallCounter = {
  /** The approved cap; it never changes. */
  readonly cap: number;
  /** Calls started so far; refused ones never started. */
  used(): number;
  /** `provider`, drawing on this count. */
  wrap(provider: Provider): Provider;
};

export function callCounter(cap: number): CallCounter {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`The call cap must be a whole number of at least 1, not ${cap}.`);
  }
  let used = 0;
  return {
    cap,
    used: () => used,
    wrap: (provider) => ({
      ...provider,
      run: <T>(spec: StageSpec<T>): Promise<StageResult<T>> => {
        // Counted before the call starts, so calls made at the same time can't pass it together.
        if (used >= cap) {
          return Promise.reject(
            new ProviderError(
              "usage_limit",
              `This Tessera has used all ${cap} of the model calls its evaluation allows, so it makes no more.`,
            ),
          );
        }
        used += 1;
        return provider.run(spec);
      },
    }),
  };
}

/**
 * The cap set by `TESSERA_CALL_CAP`, or none when it isn't set. A value that isn't a whole number
 * of at least 1 is refused, so a mistyped cap never runs as no cap.
 */
export function callCapFrom(environment: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = environment["TESSERA_CALL_CAP"];
  if (value === undefined || value === "") return undefined;
  const cap = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isInteger(cap) || cap < 1) {
    throw new Error(`TESSERA_CALL_CAP must be a whole number of at least 1, not "${value}".`);
  }
  return cap;
}
