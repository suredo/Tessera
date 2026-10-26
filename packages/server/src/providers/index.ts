// Docs: docs/code/server/providers.md
// Model connections behind one interface (CLI-01): Claude Code, and the scripted provider (ENG-11).
export {
  ProviderError,
  UNKNOWN_USAGE,
  type Provider,
  type StageResult,
  type StageSpec,
} from "./provider.ts";
export {
  createScriptedProvider,
  loadScript,
  ScriptError,
  type ScriptedProvider,
} from "./scripted.ts";
export {
  ANSWER_KEY,
  atLeast,
  buildArgs,
  cleanEnvironment,
  createClaudeProvider,
  FAILURE_MESSAGES,
  failureKind,
  findClaude,
  MAX_TURNS,
  resultEnvelopeSchema,
  TESTED_CLI_VERSION,
  toUsage,
  versionOf,
  wrapSchema,
  type ClaudeOptions,
  type ClaudeStatus,
  type ResultEnvelope,
} from "./claude.ts";
export {
  loadRoutes,
  ROUTES_FILE,
  RoutesError,
  runStage,
  type Routes,
  type StageCall,
} from "./routing.ts";
