// Docs: docs/code/server/platform.md
// Small helpers that keep paths and starting programs the same on every platform (PLAT-01).
export { isInsideFolder, normalizeNewlines, toPosixPath } from "./paths.ts";
export { findExecutable, runProcess, type ProcessResult, type RunOptions } from "./process.ts";
