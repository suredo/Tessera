import type { Loss } from "@tessera/contracts";
import { describe, expect, it } from "vitest";
import { lossText } from "../src/History.tsx";

// A restore's preview says where each lost value was in plain words (GEN-12), from the steps the
// server describes: items by their names, never their IDs.

const loss = (steps: Loss["steps"], value: Loss["value"] = true): Loss => ({
  path: ["ignored", "f00d-id"],
  value,
  steps,
});

describe("GEN-12: a lost value's place in plain words", () => {
  it("GEN-12: names an item by its name, and leaves out its list", () => {
    const text = lossText(
      loss([{ field: "tasks" }, { item: "Buy milk", in: "tasks" }, { field: "done" }], false),
    );
    expect(text).toBe("Buy milk: done was false");
  });

  it("GEN-12: names an item without a name by its list, never its ID", () => {
    const text = lossText(
      loss([{ field: "tasks" }, { item: null, in: "tasks" }, { field: "done" }]),
    );
    expect(text).toBe("An item in tasks: done was true");
    expect(text).not.toContain("f00d-id");
  });

  it("GEN-12: names an item in a list inside an item, through both", () => {
    const steps: Loss["steps"] = [
      { field: "tasks" },
      { item: "Trip", in: "tasks" },
      { field: "items" },
      { item: "Milk", in: "items" },
      { field: "note" },
    ];
    expect(lossText(loss(steps, "oat"))).toBe('Trip › Milk: note was "oat"');
    const unnamed: Loss["steps"] = [
      { field: "tasks" },
      { item: "Trip", in: "tasks" },
      { field: "items" },
      { item: null, in: "items" },
      { field: "note" },
    ];
    expect(lossText(loss(unnamed, "oat"))).toBe('Trip › an item in items: note was "oat"');
  });

  it("GEN-12: keeps the name of a field outside any list, and of nested fields", () => {
    expect(lossText(loss([{ field: "heading" }], "My planner"))).toBe('heading was "My planner"');
    expect(lossText(loss([{ field: "settings" }, { field: "theme" }], "dark"))).toBe(
      'settings › theme was "dark"',
    );
  });

  it("GEN-12: says when a whole item would go", () => {
    expect(lossText(loss([{ field: "tasks" }, { item: "Buy milk", in: "tasks" }], {}))).toBe(
      "Buy milk, the whole item",
    );
  });
});
