// Docs: docs/code/server/checks.md
// The static check: every candidate's and imported tool's code, read before it runs (VER-01, ADR 0009).
export {
  checkHtml,
  checkJs,
  staticCheck,
  type StaticCheckResult,
  type StaticFinding,
} from "./static-check.ts";
