import { INTENT_TIME_LIMIT_MS } from "../intent/index.ts";
import { GENERATION_TIME_LIMIT_MS, REPAIR_TIME_LIMIT_MS } from "./create.ts";
import { DATA_TIME_LIMIT_MS } from "./data.ts";

/**
 * How long each stage's model call may take, in milliseconds (GEN-11). A repair of a data plan
 * is held to the data limit; a repair of a tool, created or edited, to the repair limit. The
 * request's own deadline still caps every call.
 */
export type StageTimeLimits = Readonly<{
  intent: number;
  create: number;
  edit: number;
  repair: number;
  data: number;
}>;

/** The defaults, kept after M2's measurements (ADR 0012). */
export const DEFAULT_STAGE_TIME_LIMITS: StageTimeLimits = {
  intent: INTENT_TIME_LIMIT_MS,
  create: GENERATION_TIME_LIMIT_MS,
  edit: GENERATION_TIME_LIMIT_MS,
  repair: REPAIR_TIME_LIMIT_MS,
  data: DATA_TIME_LIMIT_MS,
};

/** True for a whole number of milliseconds a timer can wait: 1 ms to about 24.8 days. */
export const isTimerLimit = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647;

/** The configured limits over the defaults; an unknown stage or a bad value stops startup. */
export function checkStageTimeLimits(limits: Partial<StageTimeLimits> = {}): StageTimeLimits {
  for (const [stage, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_STAGE_TIME_LIMITS, stage))
      throw new RangeError(`stageTimeLimitsMs has no stage called "${stage}".`);
    if (value !== undefined && !isTimerLimit(value))
      throw new RangeError(`stageTimeLimitsMs.${stage} must be a positive timer-sized integer.`);
  }
  const defined = Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined));
  return Object.freeze({ ...DEFAULT_STAGE_TIME_LIMITS, ...defined });
}
