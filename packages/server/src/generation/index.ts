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
export {
  planDataChange,
  checkedDataPlan,
  commitDataPlan,
  DATA_TIME_LIMIT_MS,
  CHAT_DATA_MAX_OPERATIONS,
  type PlannedData,
  type DataPlanResult,
} from "./data.ts";
export { REQUEST_TIME_LIMIT_MS } from "./deadline.ts";
export { editedCandidate, editTool, type EditInput, type EditResult } from "./edit.ts";
export { generationRoutes, type GenerationOptions } from "./routes.ts";
