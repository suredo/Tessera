import { z } from "zod";

// The AI technical review of a live run (EVAL-03): its items and the question each asks, the marks
// it gives, and the answer it returns. The review's prompt, the scenarios' `review` items and the
// evaluation report all read these, so the rubric is defined once (P3). The reviewer applies the
// same rubric whichever model built the tool; it supplements the host's observed facts and never
// turns behavior nobody exercised into verified behavior.

/** Each item the reviewer answers, with its question, as the judging guide asks it. */
export const REVIEW_RUBRIC = {
  fulfilment: "Does the tool do what was asked, at each step?",
  "useful-at-first-sight":
    "Does a new tool show something meaningful at once, instead of an empty form (UX-01)?",
  "standard-style":
    "Does it follow the standard look where the person asked for none, and keep any look or design they asked for? Does the look of unrelated parts stay the same across changes?",
  "controls-work":
    "Do the controls that were used do what their labels say? Cite the step, screenshot or host fact that shows it. A control nobody used is unverified: its source or a screenshot can't show it works.",
  accessibility:
    "Are fields labelled and buttons named, is focus visible, is the contrast enough, and does it fit a narrow screen?",
  messages:
    "Are the host's and the tool's messages in plain words, without internal terms, and do they claim nothing the host didn't do?",
  "code-red-flags":
    "Does the source write data at startup, read the system clock instead of the host's, ignore errors, or loop without end?",
  coherence: "Does each change build on the last, or does the tool lose or reinvent parts it had?",
} as const;

export const REVIEW_ITEMS = Object.keys(REVIEW_RUBRIC) as (keyof typeof REVIEW_RUBRIC)[];
export const reviewItemSchema = z.enum(REVIEW_ITEMS as [ReviewItem, ...ReviewItem[]]);
export type ReviewItem = keyof typeof REVIEW_RUBRIC;

/** How an item came out; `unverified` is for what the run's evidence can't show either way. */
export const REVIEW_MARKS = ["pass", "partly", "fail", "unverified", "not-applicable"] as const;
export const reviewMarkSchema = z.enum(REVIEW_MARKS);
export type ReviewMark = z.infer<typeof reviewMarkSchema>;

/** The three verdicts of EVAL-04: the owner gives the final one, the reviewer only advises one. */
export const VERDICTS = ["accept", "accept-with-notes", "reject"] as const;
export const verdictSchema = z.enum(VERDICTS);
export type Verdict = z.infer<typeof verdictSchema>;

const evidence = z.string().min(1).max(400);

/** The reviewer's answer (EVAL-03): every item asked, marked, with the evidence for its mark. */
export const reviewSchema = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          item: reviewItemSchema,
          mark: reviewMarkSchema,
          evidence: z
            .array(evidence)
            .min(1)
            .max(6)
            .describe(
              "What shows the mark: a step, a screenshot, a host fact, a message or a line of source, each named as the run names it.",
            ),
        }),
      )
      .min(1)
      .max(REVIEW_ITEMS.length)
      .describe("Each item asked for, once, in the order asked."),
    verdict: verdictSchema.describe(
      "The verdict the reviewer would advise. The owner decides (EVAL-04).",
    ),
    notes: z
      .array(evidence)
      .max(8)
      .describe(
        "What the owner should look at, most important first; empty when nothing stands out.",
      ),
  })
  .describe("The AI technical review of one scenario's live run (EVAL-03).");
export type Review = z.infer<typeof reviewSchema>;

/**
 * The screenshots a review may take as image inputs (A27, CLI-08): PNG or JPEG, each at most
 * `bytes` before encoding, and at most `count` in one review, so the call stays within what the
 * model takes and what the run's evidence holds.
 */
export const REVIEW_IMAGE_LIMITS = { count: 12, bytes: 1_500_000 } as const;
export const REVIEW_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

/** One screenshot sent to the reviewer: its name in the run, its type and its bytes as base64. */
export const reviewImageSchema = z.strictObject({
  name: z.string().min(1).max(100),
  mediaType: z.enum(REVIEW_IMAGE_TYPES),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil(REVIEW_IMAGE_LIMITS.bytes / 3) * 4),
});
export type ReviewImage = z.infer<typeof reviewImageSchema>;
