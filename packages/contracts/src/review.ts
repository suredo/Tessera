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
      .superRefine((items, context) => {
        const seen = new Set<string>();
        items.forEach(({ item }, index) => {
          if (seen.has(item)) {
            context.addIssue({ code: "custom", path: [index, "item"], message: `${item} twice` });
          }
          seen.add(item);
        });
      })
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
 * The answer to a review that asked `asked`, as the host checks it: exactly those items, each
 * once, in that order. An item left out, one more, or the order changed fails the answer, as any
 * answer of the wrong shape does, so an incomplete review can't stand.
 */
export const reviewSchemaFor = (asked: readonly ReviewItem[]) =>
  reviewSchema.superRefine((review, context) => {
    const answered = review.items.map((i) => i.item);
    if (answered.join() !== asked.join()) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: `answered ${answered.join(", ")}, not ${asked.join(", ")}`,
      });
    }
  });

/**
 * The screenshots a review may take as image inputs (A27, CLI-08): PNG or JPEG, each at most
 * `bytes` before encoding, and at most `count` in one review, so the call stays within what the
 * model takes and what the run's evidence holds.
 */
export const REVIEW_IMAGE_LIMITS = { count: 12, bytes: 1_500_000 } as const;
export const REVIEW_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

/** The first bytes of each image type a review takes: PNG's signature, and JPEG's start of image. */
const SIGNATURES: Record<(typeof REVIEW_IMAGE_TYPES)[number], readonly number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * One screenshot sent to the reviewer: its name in the run, its type and its bytes as base64. The
 * bytes are checked, not only what they claim: valid base64, within the size, and starting as the
 * type they are named says, so text or another kind of image never reaches the model as one.
 */
export const reviewImageSchema = z
  .strictObject({
    name: z.string().min(1).max(100),
    mediaType: z.enum(REVIEW_IMAGE_TYPES),
    base64: z
      .string()
      .min(1)
      .max(Math.ceil(REVIEW_IMAGE_LIMITS.bytes / 3) * 4)
      .regex(BASE64, "not base64"),
  })
  .superRefine((image, context) => {
    if (!BASE64.test(image.base64)) return;
    const signature = SIGNATURES[image.mediaType];
    const start = atob(image.base64.slice(0, 16));
    if (signature.some((byte, i) => start.charCodeAt(i) !== byte)) {
      context.addIssue({
        code: "custom",
        path: ["base64"],
        message: `not a ${image.mediaType} image`,
      });
    }
  });
export type ReviewImage = z.infer<typeof reviewImageSchema>;
