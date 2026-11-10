// Docs: docs/code/evals/review.md
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  DEFAULT_ROUTES,
  REVIEW_IMAGE_LIMITS,
  REVIEW_ITEMS,
  reviewSchemaFor,
  VERDICTS,
  type Review,
  type ReviewImage,
  type ReviewItem,
} from "@tessera/contracts";
import {
  assembleReviewPrompt,
  createScriptedProvider,
  loadVersion,
  openDataFolder,
  REVIEW_PROMPT_BUDGET,
  type Provider,
  type ReviewData,
  type ReviewStep,
  type ReviewVersion,
} from "@tessera/server";
import { refuseRealDataFolder, startHarness } from "../harness/index.ts";
import type { RunReport } from "../runner/run.ts";
import { loadScenario } from "../scenarios/index.ts";

// The AI technical review of one recorded run (EVAL-03): it gathers the run's evidence (each
// step, the host's message and facts, the final source of every version of every tool, and the
// screenshots), asks the review stage once through the harness, which caps and records the call
// (ENG-07), and keeps the structured answer with the run. It never runs the scenario again.

const SCENARIOS = path.resolve(import.meta.dirname, "../../scenarios");
/** The review's own harness folder, beside the run's. */
export const REVIEW_HARNESS = "review-harness";
/** The structured review, kept with the run (EVAL-03). */
export const REVIEW_FILE = "review.json";
/** How long the review may take, as long as a large creation. */
export const REVIEW_TIME_LIMIT_MS = 300_000;

/** A run's evidence, as the review reads it. */
export type RunEvidence = {
  scenario: string;
  items: ReviewItem[];
  steps: ReviewStep[];
  versions: ReviewVersion[];
  /** Each tool's data at the end of the run and its recorded data changes (L-92). */
  data: ReviewData[];
  /** Each step screenshot the run kept, by name and file, in step order. */
  screenshots: { name: string; file: string }[];
};

/** A recorded version as the run's database holds it, with its workspace's title. */
const versionRow = z.object({
  title: z.string(),
  deleted_at: z.string().nullable(),
  number: z.number(),
  hash: z.string(),
  summary: z.string().nullable(),
  checks: z.string(),
  profile: z.string().nullable(),
});

/** A workspace's title and data, and its recorded data changes, as the run's database holds them. */
const workspaceRow = z.object({
  id: z.string(),
  title: z.string(),
  deleted_at: z.string().nullable(),
  data: z.string().nullable(),
});
const undoRow = z.object({ change: z.string() });
/** A recorded data change, read only as far as the review needs (the server's undo log). */
const changeShape = z.union([
  z.object({
    kind: z.literal("records"),
    records: z.array(
      z.object({
        collection: z.string(),
        id: z.string(),
        before: z.unknown(),
        revisionAfter: z.number().nullable(),
      }),
    ),
  }),
  z.object({ kind: z.literal("whole") }),
]);
/** How much of a tool's final entries the review quotes, so one large tool can't fill the prompt. */
export const DATA_QUOTE_LIMIT = 6_000;

/** What a recorded change did, in a word the reviewer reads: added, changed or removed. */
function describeChange(raw: string): ReviewData["changes"][number] {
  const parsed = changeShape.safeParse(JSON.parse(raw));
  if (!parsed.success) return { records: [] };
  if (parsed.data.kind === "whole") {
    return { records: [{ collection: "", id: "", change: "replaced whole", before: null }] };
  }
  return {
    records: parsed.data.records.map((r) => ({
      collection: r.collection,
      id: r.id,
      change: r.before == null ? "added" : r.revisionAfter == null ? "removed" : "changed",
      before: r.before ?? null,
    })),
  };
}

/** The steps' screenshots to send: every one when they fit the limit, else spread over the run. */
export function chooseScreenshots<T>(all: readonly T[], count = REVIEW_IMAGE_LIMITS.count): T[] {
  if (all.length <= count) return [...all];
  // The first and the last, and the rest evenly between them.
  return Array.from(
    { length: count },
    (_, i) => all[Math.round((i * (all.length - 1)) / (count - 1))]!,
  );
}

/** Reads a finished run's folder: its report, its scenario's review items, its tools and screenshots. */
export async function gatherRun(folder: string): Promise<RunEvidence> {
  const report = JSON.parse(fs.readFileSync(path.join(folder, "report.json"), "utf8")) as RunReport;
  const scenario = loadScenario(path.join(SCENARIOS, `${report.scenario}.yaml`));
  const items = scenario.review.length > 0 ? [...scenario.review] : [...REVIEW_ITEMS];
  const screenshots = report.steps.flatMap((s) => {
    const file = path.join(folder, `step-${s.index}.png`);
    return s.outcome !== "blocked" && fs.existsSync(file)
      ? [{ name: `step-${s.index}.png`, file }]
      : [];
  });
  const sent = new Set(chooseScreenshots(screenshots).map((s) => s.name));
  const steps: ReviewStep[] = report.steps.map((s) => ({
    step: s.index,
    action: s.action,
    outcome: s.outcome,
    message: s.notice,
    problems: s.problems,
    ...(sent.has(`step-${s.index}.png`) ? { screenshot: `step-${s.index}.png` } : {}),
  }));
  // Each version once, by its hash, in the order they were made: Use again and saving copy a
  // version into another workspace. A workspace moved to the trash during the run keeps its
  // versions, which the review reads too, marked so, without restoring or changing anything.
  const versions: ReviewVersion[] = [];
  const data: ReviewData[] = [];
  const tessera = path.join(folder, "tessera");
  // The run's own Tessera, never the person's (ENG-19): refused before anything opens it.
  refuseRealDataFolder(tessera);
  const store = await openDataFolder(tessera);
  try {
    const seen = new Set<string>();
    const rows = store.db.all(
      versionRow,
      `SELECT w.title, w.deleted_at, v.number, v.hash, v.summary, v.checks, v.profile
        FROM workspace_versions v JOIN workspaces w ON w.id = v.workspace_id
        ORDER BY v.created_at, w.id, v.number`,
    );
    for (const row of rows) {
      if (seen.has(row.hash)) continue;
      seen.add(row.hash);
      const read = loadVersion(store.db, row.hash);
      if (read?.kind !== "ok") continue;
      const { html, css, js } = read.artifact.code;
      versions.push({
        tool: row.deleted_at ? `${row.title} (moved to the trash)` : row.title,
        version: row.number,
        summary: row.summary ?? "",
        checks: JSON.parse(row.checks) as string[],
        profile: row.profile,
        html,
        css,
        js,
      });
    }
    // Each tool's data: its entries at the end, and the changes the run recorded, oldest first.
    // Undoing a change uses its entry up, so an undone change isn't listed (L-92).
    for (const workspace of store.db.all(
      workspaceRow,
      "SELECT id, title, deleted_at, data FROM workspaces ORDER BY created_at, id",
    )) {
      const atEnd = workspace.data ?? "{}";
      data.push({
        tool: workspace.deleted_at ? `${workspace.title} (moved to the trash)` : workspace.title,
        atEnd:
          atEnd.length > DATA_QUOTE_LIMIT
            ? `${atEnd.slice(0, DATA_QUOTE_LIMIT)}… (cut short)`
            : atEnd,
        changes: store.db
          .all(
            undoRow,
            "SELECT change FROM data_undo WHERE workspace_id = ? ORDER BY number",
            workspace.id,
          )
          .map((row) => describeChange(row.change)),
      });
    }
  } finally {
    store.close();
  }
  return { scenario: report.scenario, items, steps, versions, data, screenshots };
}

/** Each screenshot as an image input, or why it can't be one (too large, or not a PNG). */
function asImages(screenshots: RunEvidence["screenshots"]): {
  images: ReviewImage[];
  skipped: string[];
} {
  const images: ReviewImage[] = [];
  const skipped: string[] = [];
  for (const shot of chooseScreenshots(screenshots)) {
    const bytes = fs.readFileSync(shot.file);
    if (bytes.length > REVIEW_IMAGE_LIMITS.bytes) {
      skipped.push(`${shot.name} is larger than ${REVIEW_IMAGE_LIMITS.bytes} bytes`);
      continue;
    }
    images.push({ name: shot.name, mediaType: "image/png", base64: bytes.toString("base64") });
  }
  return { images, skipped };
}

/** What a review run keeps with the run (EVAL-03): the answer and how it was made. */
export type ReviewRecord = {
  scenario: string;
  mode: "live" | "rehearsal";
  provider: string;
  reviewedAt: string;
  /** The screenshots sent as images, in order; empty when none could be (A27). */
  images: string[];
  /** Why no screenshot, or not every one, was sent. */
  imagesLeftOut: string[];
  review: Review;
  /** The owner's verdict (EVAL-04), filled in by the owner; null until then. */
  ownerVerdict: (typeof VERDICTS)[number] | null;
};

/** A canned review for a rehearsal: every item unverified, as no model was asked. */
export const rehearsalReview = (items: readonly ReviewItem[]): Review => ({
  items: items.map((item) => ({
    item,
    mark: "unverified",
    evidence: ["A rehearsal: no model was asked."],
  })),
  verdict: "accept-with-notes",
  notes: ["A rehearsal of the review: no model was asked."],
});

/**
 * Reviews the run in `folder` once (EVAL-03). A live review needs the owner's approved cap and a
 * provider that can reach a model; a rehearsal answers from a canned review at no cost. The call
 * goes through the harness, in the run's own `review-harness` folder, which must be new.
 */
export async function reviewRun(
  folder: string,
  options:
    | { mode: "live"; provider: Provider; callCap: number }
    | { mode: "rehearsal"; callCap?: number; provider?: Provider },
): Promise<ReviewRecord> {
  const evidence = await gatherRun(folder);
  const provider =
    options.provider ??
    createScriptedProvider({
      name: "review-rehearsal",
      replies: [{ kind: "value", stage: "review", value: rehearsalReview(evidence.items) }],
    });
  const harness = startHarness({
    provider,
    mode: options.mode === "live" ? "live" : "dry-run",
    callCap: options.callCap ?? 1,
    dataFolder: path.join(folder, REVIEW_HARNESS),
  });
  const { images, skipped } = provider.acceptsImages
    ? asImages(evidence.screenshots)
    : { images: [], skipped: [] };
  const imagesLeftOut = provider.acceptsImages
    ? skipped
    : [`${provider.name} can't pass images to the model`];
  const prompt = assembleReviewPrompt({
    scenario: evidence.scenario,
    items: evidence.items,
    steps: evidence.steps.map((s) =>
      s.screenshot && !images.some((i) => i.name === s.screenshot)
        ? { ...s, screenshot: undefined }
        : s,
    ),
    versions: evidence.versions,
    data: evidence.data,
    images: images.map((i) => i.name),
    ...(images.length === 0 ? { noImages: imagesLeftOut.join("; ") || "the run kept none" } : {}),
  });
  if (prompt.size > REVIEW_PROMPT_BUDGET) {
    throw new Error(
      `The review's prompt is ${prompt.size} characters, over its budget of ${REVIEW_PROMPT_BUDGET}.`,
    );
  }
  const route = DEFAULT_ROUTES.review;
  try {
    const { value } = await harness.provider.run({
      stage: "review",
      system: prompt.system,
      prompt: prompt.prompt,
      promptParts: prompt.parts,
      // The host checks the answer has exactly the items asked, each once, in order (EVAL-03).
      schema: reviewSchemaFor(evidence.items),
      model: route.model,
      effort: route.effort,
      tools: "none",
      timeLimitMs: REVIEW_TIME_LIMIT_MS,
      images,
    });
    const record: ReviewRecord = {
      scenario: evidence.scenario,
      mode: options.mode,
      provider: provider.name,
      reviewedAt: new Date().toISOString(),
      images: images.map((i) => i.name),
      imagesLeftOut,
      review: value,
      ownerVerdict: null,
    };
    fs.writeFileSync(path.join(folder, REVIEW_FILE), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    harness.finish();
  }
}

const MARKS: Record<Review["items"][number]["mark"], string> = {
  pass: "pass",
  partly: "partly",
  fail: "fail",
  unverified: "unverified",
  "not-applicable": "not applicable",
};

/** The review as Markdown for the run's report (EVAL-04), with a line for the owner's verdict. */
export function reviewMarkdown(record: ReviewRecord): string {
  const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `## AI review (${record.mode}, ${record.provider})`,
    "",
    record.images.length > 0
      ? `Screenshots sent as images: ${record.images.join(", ")}.`
      : `No screenshots were sent: ${record.imagesLeftOut.join("; ") || "the run kept none"}.`,
    "",
    "| Item | Mark | Evidence |",
    "| --- | --- | --- |",
    ...record.review.items.map(
      (i) => `| ${i.item} | ${MARKS[i.mark]} | ${i.evidence.map(cell).join("<br>")} |`,
    ),
    "",
    `**Advised verdict:** ${record.review.verdict.replace(/-/g, " ")}.`,
    ...(record.review.notes.length
      ? ["", "**Notes:**", ...record.review.notes.map((n) => `- ${n}`)]
      : []),
    "",
    `**Owner's verdict (EVAL-04):** ${record.ownerVerdict ? record.ownerVerdict.replace(/-/g, " ") : "not given yet: accept, accept with notes, or reject."}`,
    "",
  ];
  return lines.join("\n");
}
