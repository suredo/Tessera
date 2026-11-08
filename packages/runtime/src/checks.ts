import type { MountedTool } from "./host.ts";
import type { DriveResult, DriveStep } from "./protocol.ts";

// The checks a candidate runs in the staging panel before it may be activated (RUN-03): the smoke
// check (VER-02), and a stub for tests. The static check (VER-01) runs on the server, before a
// candidate reaches staging; behavior checks drive the candidate
// through its hooks with `driveTool` (VER-03).

/** A check's verdict: passed, or failed with a plain reason the person could read. */
export type CheckOutcome = { ok: true } | { ok: false; reason: string };

/** What a check gets: the candidate running in the hidden panel, against synthetic data. */
export type CheckContext = {
  /** The candidate, mounted in the panel; it can't write (BRG-06). */
  tool: MountedTool;
  /** The hidden panel, laid out at the narrow width the UI standard sets (320 px wide). */
  panel: HTMLElement;
  /** Aborted when staging is cancelled; a check stops waiting then. */
  signal: AbortSignal;
  /**
   * Starts the candidate again in the panel for a behavior check, its saves going to a throwaway
   * copy of its synthetic data, and resolves with it (VER-03, BRG-06). Each later call starts it
   * again on what it has saved so far, as reopening it would. The copy is never the person's data
   * and is never stored: it goes with the panel. The tool this context gave is unmounted.
   */
  rehearse(): Promise<MountedTool>;
};

export type VerificationCheck = {
  /** Shown with a failure, so the person knows which check said no. */
  name: string;
  /** True only for a placeholder that checks nothing. */
  stub?: boolean;
  run(context: CheckContext): Promise<CheckOutcome>;
};

/**
 * A STUB, not a check: it checks nothing and gives `outcome`, so staging can be built and tested
 * before the real checks exist (VER-01 and VER-02, M2). Never rely on it to judge a tool.
 */
export const stubCheck = (outcome: CheckOutcome = { ok: true }): VerificationCheck => ({
  name: "stub",
  stub: true,
  run: () => Promise.resolve(outcome),
});

/** What the tool's page reports to the smoke check (VER-02). */
export type SmokeReport = {
  /** What went wrong as it started: errors, unhandled rejections, blocked attempts. */
  problems: string[];
  /** How many elements its page holds. */
  elements: number;
  /** How much text it shows, in characters. */
  text: number;
  /** How many drawings, images and videos it shows. */
  media: number;
  /** How far its page is wider than the panel, in pixels; more than 0 scrolls sideways. */
  overflow: number;
  /** Fields without a label, buttons without a name, and images without alt text. */
  unlabeled: number;
  unnamed: number;
  noAlt: number;
};

const COUNTS = ["elements", "text", "media", "overflow", "unlabeled", "unnamed", "noAlt"] as const;

function readReport(value: unknown): SmokeReport | undefined {
  const report = value as Partial<Record<string, unknown>> | null;
  if (typeof report !== "object" || report === null) return undefined;
  if (!Array.isArray(report["problems"])) return undefined;
  if (!COUNTS.every((key) => typeof report[key] === "number")) return undefined;
  return {
    ...(report as SmokeReport),
    problems: (report["problems"] as unknown[]).map(String),
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The smoke check (VER-02): the candidate started for real in the hidden panel, at 320 px, must
 * show something, start without errors, not scroll sideways, and meet the accessibility floor's
 * basics: every field labelled, every button named, every image with alt text. Its reason lists
 * every problem, for repair (GEN-09). The report is the page's own word, so the check judges
 * quality, not safety: the sandbox and the static check do that.
 */
export const smokeCheck = (options: { timeoutMs?: number } = {}): VerificationCheck => ({
  name: "smoke",
  async run({ tool }) {
    const report = readReport(await tool.inspect(options.timeoutMs));
    if (!report) return { ok: false, reason: "The tool's report couldn't be read." };
    const found: string[] = [...report.problems];
    if (report.elements === 0 || (report.text === 0 && report.media === 0)) {
      found.push("The tool shows nothing.");
    }
    if (report.overflow > 1) {
      found.push(`At 320 px wide, the tool scrolls sideways by ${Math.round(report.overflow)} px.`);
    }
    if (report.unlabeled > 0) {
      found.push(`${plural(report.unlabeled, "field has", "fields have")} no label.`);
    }
    if (report.unnamed > 0) {
      found.push(`${plural(report.unnamed, "button has", "buttons have")} no name.`);
    }
    if (report.noAlt > 0) {
      found.push(`${plural(report.noAlt, "image has", "images have")} no alt text.`);
    }
    return found.length === 0 ? { ok: true } : { ok: false, reason: found.join(" ") };
  },
});

/** What the tool's page answered to a behavior check's steps (VER-03). */
export type DriveReport = {
  /** What went wrong since it started, as for the smoke check. */
  problems: string[];
  /** One result per step taken; the first that failed is the last. */
  steps: DriveResult[];
};

function readStep(value: unknown): DriveResult | undefined {
  const step = value as Partial<Record<string, unknown>> | null;
  if (typeof step !== "object" || step === null) return undefined;
  if (step["ok"] === false) {
    return typeof step["problem"] === "string"
      ? { ok: false, problem: step["problem"] }
      : undefined;
  }
  if (step["ok"] !== true) return undefined;
  const texts = step["texts"];
  return {
    ok: true,
    ...(typeof step["count"] === "number" ? { count: step["count"] } : {}),
    ...(Array.isArray(texts) ? { texts: texts.map(String) } : {}),
  };
}

/**
 * Takes `steps` on the candidate and reads its page's answer; undefined when the answer can't be
 * read. The answer is the page's word, so a behavior check judges quality, not safety.
 */
export async function driveTool(
  tool: MountedTool,
  steps: readonly DriveStep[],
  timeoutMs?: number,
): Promise<DriveReport | undefined> {
  const report = (await tool.drive(steps, timeoutMs)) as Partial<Record<string, unknown>> | null;
  if (typeof report !== "object" || report === null) return undefined;
  const problems = report["problems"];
  const results = report["steps"];
  if (!Array.isArray(problems) || !Array.isArray(results)) return undefined;
  const read = results.map(readStep);
  if (!read.every((step) => step !== undefined)) return undefined;
  return { problems: problems.map(String), steps: read };
}
