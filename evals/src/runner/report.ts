// Docs: docs/code/evals/runner.md
import type { RunReport } from "./run.ts";

// The evaluation report for one run (EVAL-02, A40): each step with what the person did, what the
// host said, and every host fact that failed; the requests' first-attempt count apart from the
// lifecycle steps; and what the run cost from the harness's ledger. It reports, never judges:
// quality is the AI review's and the person's (EVAL-03, EVAL-04).

/** The report as Markdown, for a person to read beside the run's screenshots and video. */
export function reportMarkdown(report: RunReport): string {
  const requests = report.steps.filter((s) => s.kind === "say");
  const lifecycle = report.steps.filter((s) => s.kind !== "say");
  const passed = (steps: typeof report.steps) => steps.filter((s) => s.outcome === "passed").length;
  const { ledger } = report;
  const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";
  const lines = [
    `# ${report.scenario}: ${report.mode}`,
    "",
    `Started at the scenario's time ${report.startedAt}; took ${report.seconds.toFixed(0)} s.`,
    "",
    `- **Requests passed at the first attempt:** ${passed(requests)} of ${requests.length}.`,
    `- **Lifecycle steps passed:** ${passed(lifecycle)} of ${lifecycle.length}; every one must pass.`,
    `- **Calls:** ${ledger.callCount} (${ledger.failedCount} failed, ${ledger.refusedCount} refused); tokens in ${ledger.inputTokens}, cached ${ledger.cachedInputTokens}, out ${ledger.outputTokens}${ledger.unknownUsageCount ? `; ${ledger.unknownUsageCount} with unknown usage` : ""}.`,
    ...(report.stopped ? [`- **Stopped early:** ${report.stopped}`] : []),
    "",
    "| Step | Action | Outcome | Host said | Problems |",
    "| --- | --- | --- | --- | --- |",
    ...report.steps.map(
      (s) =>
        `| ${s.index} | ${cell(s.action)} | ${s.outcome} | ${cell(s.notice)} | ${cell(s.problems.join("; "))} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
