// Docs: docs/code/server/intent.md
// The intent stage: what a request asks for, and what the host does with it (GEN-01, ADR 0008).
export {
  decideIntent,
  INTENT_TIME_LIMIT_MS,
  recordLists,
  wordsNotInRequest,
  type IntentDecision,
  type IntentInput,
} from "./intent.ts";
