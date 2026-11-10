import { describe, expect, it } from "vitest";
import {
  REVIEW_IMAGE_LIMITS,
  REVIEW_ITEMS,
  REVIEW_RUBRIC,
  reviewImageSchema,
  reviewSchema,
  reviewSchemaFor,
  type Review,
} from "../src/index.ts";

// The AI review's contract (EVAL-03, A27): the one rubric, an answer that marks every item asked
// exactly once, and screenshots whose bytes are what they claim to be.

const mark = (item: Review["items"][number]["item"]) => ({
  item,
  mark: "pass" as const,
  evidence: ["step 1"],
});
const answer = (...items: Review["items"][number]["item"][]): Review => ({
  items: items.map(mark),
  verdict: "accept",
  notes: [],
});

describe("the review's answer (EVAL-03)", () => {
  it("EVAL-03: has one question for each item, and the items are the rubric's", () => {
    expect(REVIEW_ITEMS).toEqual(Object.keys(REVIEW_RUBRIC));
    for (const item of REVIEW_ITEMS) expect(REVIEW_RUBRIC[item].length).toBeGreaterThan(10);
  });

  it("EVAL-03: refuses an item answered twice, wherever it repeats", () => {
    expect(reviewSchema.safeParse(answer("fulfilment", "fulfilment")).success).toBe(false);
    expect(reviewSchema.safeParse(answer("fulfilment", "messages", "fulfilment")).success).toBe(
      false,
    );
    expect(reviewSchema.safeParse(answer("fulfilment", "messages")).success).toBe(true);
  });

  it("EVAL-03: for the items asked, refuses one left out, one more, or the order changed", () => {
    const asked = ["fulfilment", "controls-work", "messages"] as const;
    const schema = reviewSchemaFor(asked);
    expect(schema.safeParse(answer(...asked)).success).toBe(true);
    // A passing item in place of one asked: an accept with the asked item left out.
    expect(schema.safeParse(answer("fulfilment", "messages")).success).toBe(false);
    expect(schema.safeParse(answer(...asked, "coherence")).success).toBe(false);
    expect(schema.safeParse(answer("controls-work", "fulfilment", "messages")).success).toBe(false);
    expect(schema.safeParse(answer("fulfilment", "fulfilment", "messages")).success).toBe(false);
  });
});

describe("a screenshot as an image input (A27)", () => {
  // A 1×1 PNG, and the first bytes of a JPEG.
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46));
  const GIF = btoa("GIF89a\x01\x00\x01\x00\x00\x00\x00;");
  const image = (mediaType: "image/png" | "image/jpeg", base64: string) => ({
    name: "step-1.png",
    mediaType,
    base64,
  });

  it("A27: takes a PNG or a JPEG whose bytes start as their type says", () => {
    expect(reviewImageSchema.safeParse(image("image/png", PNG)).success).toBe(true);
    expect(reviewImageSchema.safeParse(image("image/jpeg", JPEG)).success).toBe(true);
  });

  it("A27: refuses text that isn't base64, bytes that aren't an image, and another type named as one", () => {
    expect(reviewImageSchema.safeParse(image("image/png", "!!!!")).success).toBe(false);
    expect(reviewImageSchema.safeParse(image("image/png", btoa("this is not a PNG"))).success).toBe(
      false,
    );
    expect(reviewImageSchema.safeParse(image("image/png", GIF)).success).toBe(false);
    // A PNG named as a JPEG is refused too.
    expect(reviewImageSchema.safeParse(image("image/jpeg", PNG)).success).toBe(false);
  });

  it("A27: refuses one larger than the limit, by its encoded size", () => {
    const tooLong = PNG.slice(0, 12) + "A".repeat(Math.ceil(REVIEW_IMAGE_LIMITS.bytes / 3) * 4);
    expect(reviewImageSchema.safeParse(image("image/png", tooLong)).success).toBe(false);
  });
});
