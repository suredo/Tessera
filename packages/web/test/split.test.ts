import { describe, expect, it } from "vitest";
import { clampShare, keyShare, SPLIT } from "../src/Split.tsx";

// The divider between the chat and the tool (APP-01, APP-11): its share stays within its limits,
// and each key it takes moves it by a step or to a limit.

describe("the divider (APP-01)", () => {
  it("APP-01: keeps the chat's share within its limits, as a whole percent", () => {
    expect(clampShare(10)).toBe(SPLIT.min);
    expect(clampShare(90)).toBe(SPLIT.max);
    expect(clampShare(42.6)).toBe(43);
  });

  it("APP-11: arrows move it a step, Home and End to the limits, and other keys do nothing", () => {
    expect(keyShare("ArrowRight", 40)).toBe(40 + SPLIT.step);
    expect(keyShare("ArrowUp", 40)).toBe(40 + SPLIT.step);
    expect(keyShare("ArrowLeft", 40)).toBe(40 - SPLIT.step);
    expect(keyShare("ArrowDown", 40)).toBe(40 - SPLIT.step);
    expect(keyShare("ArrowRight", SPLIT.max)).toBe(SPLIT.max);
    expect(keyShare("ArrowLeft", SPLIT.min)).toBe(SPLIT.min);
    expect(keyShare("Home", 50)).toBe(SPLIT.min);
    expect(keyShare("End", 50)).toBe(SPLIT.max);
    expect(keyShare("Enter", 50)).toBeUndefined();
  });
});
