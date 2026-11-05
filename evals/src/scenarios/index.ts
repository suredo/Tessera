// Docs: docs/code/evals/scenarios.md
// Scenario files and the host facts each step is checked against (EVAL-01, EVAL-02).
export {
  expectationSchema,
  loadScenario,
  loadScenarios,
  M2_STEPS,
  m2Problems,
  ScenarioError,
  scenarioSchema,
  stepKind,
  stepSchema,
  type Expectation,
  type Scenario,
  type Step,
} from "./scenario.ts";
export {
  checkFacts,
  readHostState,
  type HostState,
  type StepOutcome,
  type WorkspaceFacts,
} from "./facts.ts";
