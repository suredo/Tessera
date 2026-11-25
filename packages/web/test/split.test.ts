import { describe, expect, it } from "vitest";
import { clampShare, initialShare, keyShare, minShare, SPLIT } from "../src/Split.tsx";

// The divider between the chat and the tool (APP-01, APP-11): its share stays within its limits,
// and each key it takes moves it by a step or to a limit.

describe("the divider (APP-01)", () => {
  it("APP-01: keeps the chat's share within its limits, as a whole percent", () => {
    expect(clampShare(10)).toBe(SPLIT.min);
    expect(clampShare(90)).toBe(SPLIT.max);
    expect(clampShare(42.6)).toBe(43);
  });

  it("APP-01: opens 380 px wide, and can always be that narrow again", () => {
    expect(initialShare(1440)).toBe(26);
    expect(minShare(1440)).toBe(SPLIT.min);
    expect(minShare(2560)).toBe(initialShare(2560));
    expect(initialShare(2560)).toBe(15);
    expect(keyShare("ArrowRight", 20, minShare(2560))).toBe(15);
    expect(keyShare("ArrowRight", 15, minShare(2560))).toBe(15);
    expect(keyShare("Home", 40, minShare(2560))).toBe(15);
  });

  it("APP-11: arrows move it a step, Home and End to the limits, and other keys do nothing", () => {
    expect(keyShare("ArrowRight", 40)).toBe(40 - SPLIT.step);
    expect(keyShare("ArrowUp", 40)).toBe(40 + SPLIT.step);
    expect(keyShare("ArrowLeft", 40)).toBe(40 + SPLIT.step);
    expect(keyShare("ArrowDown", 40)).toBe(40 - SPLIT.step);
    expect(keyShare("ArrowLeft", SPLIT.max)).toBe(SPLIT.max);
    expect(keyShare("ArrowRight", SPLIT.min)).toBe(SPLIT.min);
    expect(keyShare("Home", 50)).toBe(SPLIT.min);
    expect(keyShare("End", 50)).toBe(SPLIT.max);
    expect(keyShare("Enter", 50)).toBeUndefined();
  });
});
