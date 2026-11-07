// Docs: docs/code/server/providers.md
// Model connections behind one interface (CLI-01): Claude Code, Codex, and the scripted provider (ENG-11).
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
  buildArgs as buildCodexArgs,
  CODEX_FAILURE_MESSAGES,
  codexFailureKind,
  codexSignInCommand,
  createCodexProvider,
  findCodex,
  HOME_INSTRUCTION_FILES,
  inputText as codexInputText,
  MODEL_CATALOG_FILE,
  OUTPUT_SCHEMA_FILE,
  parseEvents as parseCodexEvents,
  restrictCatalog,
  TESTED_CODEX_VERSION,
  toUsage as toCodexUsage,
  type CodexEvent,
  type CodexOptions,
  type CodexStatus,
} from "./codex.ts";
export {
  loadRoutes,
  ROUTES_FILE,
  RoutesError,
  runStage,
  type Routes,
  type StageCall,
} from "./routing.ts";
