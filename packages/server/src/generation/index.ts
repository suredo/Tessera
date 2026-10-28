// Docs: docs/code/server/generation.md
// The generation stages: a request becomes a checked candidate tool (GEN-04, GEN-05, GEN-09).
export {
  candidateFrom,
  dataProblems,
  createTool,
  GENERATION_TIME_LIMIT_MS,
  REPAIR_BUDGETS,
  REPAIR_TIME_LIMIT_MS,
  startingDataOf,
  type Candidate,
  type CreateInput,
  type CreateResult,
} from "./create.ts";
export { generate } from "./pipeline.ts";
export { editedCandidate, editTool, type EditInput, type EditResult } from "./edit.ts";
export { generationRoutes, type GenerationOptions } from "./routes.ts";
