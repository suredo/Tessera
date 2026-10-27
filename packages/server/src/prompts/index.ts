// Docs: docs/code/server/prompts.md
// Prompts built from versioned parts, chosen by stage and structured intent (GEN-03, ENG-16, GEN-02).
export {
  assembleIntentPrompt,
  assemblePrompt,
  fillPart,
  fixedPart,
  INTENT_PROMPT_BUDGET,
  manifestForPrompt,
  partText,
  PROMPT_BUDGETS,
  PROMPT_PARTS,
  partVersion,
  type AssembledPrompt,
  type OpenTool,
  type RecordList,
  type GenerationStage,
  type PromptInput,
  type PromptPart,
} from "./prompts.ts";
