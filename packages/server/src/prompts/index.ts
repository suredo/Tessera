// Docs: docs/code/server/prompts.md
// Prompts built from versioned parts, chosen by stage and structured intent (GEN-03, ENG-16, GEN-02).
export {
  assemblePrompt,
  fillPart,
  fixedPart,
  manifestForPrompt,
  partText,
  PROMPT_BUDGETS,
  PROMPT_PARTS,
  partVersion,
  type AssembledPrompt,
  type GenerationStage,
  type PromptInput,
  type PromptPart,
} from "./prompts.ts";
