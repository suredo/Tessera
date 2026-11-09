import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkFacts,
  loadScenario,
  loadScenarios,
  stepKind,
  type HostState,
  type StepOutcome,
} from "../src/scenarios/index.ts";

// Scenario files (EVAL-01) and the host facts checked after each step (EVAL-02).

const scenarios = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scenarios");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-scenarios-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** Writes a scenario file named after its ID, with the given text after a valid header. */
function scenarioFile(id: string, rest: string): string {
  const file = path.join(root, `${id}.yaml`);
  fs.writeFileSync(
    file,
    `id: ${id}\ntier: simple\nlanguage: en\nperson: "Someone"\n` +
      `clock: { start: "2026-10-12T09:00:00", zone: "UTC" }\nbudget: { calls: 3 }\n${rest}`,
  );
  return file;
}

describe("scenario files (EVAL-01)", () => {
  it("EVAL-01: every scenario loads and starts with a request", () => {
    const all = loadScenarios(scenarios);
    expect(all.map((s) => s.id)).toEqual([
      "B10-study-planner",
      "B2-reading-list",
      "B4-habit-tracker",
      "J6-limits",
      "T1-shopping-list",
      "T13-drawing-board",
      "T6-tip-calculator",
    ]);
    for (const scenario of all) {
      // Every scenario starts from an empty Tessera, so its first step is a request.
      expect(stepKind(scenario.steps[0]!)).toBe("say");
    }
    // The M2 live set's budgets (docs/roadmap/m2-generation-pipeline.md), and the two-pass
    // comparison's, each fitting its two-pass run (evals/reports/2026-11-07-two-pass-plan.md).
    expect(Object.fromEntries(all.map((s) => [s.id, s.budget.calls]))).toEqual({
      "B10-study-planner": 7,
      "B2-reading-list": 7,
      "B4-habit-tracker": 7,
      "J6-limits": 5,
      "T1-shopping-list": 10,
      "T13-drawing-board": 7,
      "T6-tip-calculator": 7,
    });
  });

  it("EVAL-01: refuses a file that isn't a scenario, saying why", () => {
    const refused = (id: string, rest: string, problem: RegExp) =>
      expect(() => loadScenario(scenarioFile(id, rest))).toThrow(problem);
    refused("T90-unknown-step", "steps:\n  - shout: hello\n", /steps\.0/);
    refused("T91-unknown-fact", "steps:\n  - say: hi\n    expect: { happy: true }\n", /steps\.0/);
    refused("T92-no-steps", "steps: []\n", /steps/);
    refused("T93-bad-cancel", "steps:\n  - reload: true\n  - cancel: true\n", /cancel step/);
    refused("T94-bad-yaml", "steps: [\n", /isn't a scenario/);
    const misnamed = scenarioFile("T95-file", "steps:\n  - say: hi\n");
    fs.writeFileSync(misnamed, fs.readFileSync(misnamed, "utf8").replace("T95-file", "T95-other"));
    expect(() => loadScenario(misnamed)).toThrow(/its id is T95-other/);
  });

  it("EVAL-01, VER-04: a do step clicks or fills a hook of one of the scenario's profiles, perhaps inside one element", () => {
    const scenario = loadScenario(
      scenarioFile(
        "T96-controls",
        "profiles: [item-list]\nsteps:\n  - say: hi\n" +
          "  - do: { fill: item-name, value: Eggs }\n" +
          "  - do: { click: item-add }\n    expect: { data: changed }\n" +
          "  - do: { click: item-remove, in: { hook: item, text: Milk } }\n",
      ),
    );
    expect(scenario.steps.slice(1).map((s) => [stepKind(s), "do" in s && s.do])).toEqual([
      ["do", { fill: "item-name", value: "Eggs" }],
      ["do", { click: "item-add" }],
      ["do", { click: "item-remove", in: { hook: "item", text: "Milk" } }],
    ]);
    const refused = (id: string, rest: string, problem: RegExp) =>
      expect(() => loadScenario(scenarioFile(id, rest))).toThrow(problem);
    // A hook none of its profiles has, or any hook with no profile, would guess at the markup.
    refused(
      "T97-unknown-hook",
      "profiles: [item-list]\nsteps:\n  - say: hi\n  - do: { click: toggle-item }\n",
      /the hook toggle-item isn't one of the scenario's profiles' hooks/,
    );
    refused(
      "T98-no-profile",
      "steps:\n  - say: hi\n  - do: { click: item-add }\n",
      /the hook item-add isn't one/,
    );
    refused(
      "T99-unknown-in",
      "profiles: [item-list]\nsteps:\n  - say: hi\n  - do: { click: item-remove, in: { hook: row, text: Milk } }\n",
      /the hook row isn't one/,
    );
    // The old shape, a fill with no value, and a profile that doesn't exist are refused too.
    refused(
      "T89-old-shape",
      "profiles: [item-list]\nsteps:\n  - say: hi\n  - do: { hook: item-add }\n",
      /steps\.1/,
    );
    refused(
      "T88-fill-no-value",
      "profiles: [item-list]\nsteps:\n  - say: hi\n  - do: { fill: item-name }\n",
      /steps\.1/,
    );
    refused("T87-unknown-profile", "profiles: [todo]\nsteps:\n  - say: hi\n", /profiles/);
  });
});

describe("host facts (EVAL-02)", () => {
  const list = { id: "w1", title: "Shopping list", version: "v1", dataHash: "d1" };
  const notes = { id: "w2", title: "Notes", version: "n1", dataHash: "e1" };
  const state = (open: string | null, ...workspaces: HostState["workspaces"]): HostState => ({
    workspaces,
    savedTools: [{ id: "s1", name: "Weekly shopping", workspaceId: "w1" }],
    open,
  });
  const none: StepOutcome = { claim: "none" };

  it("EVAL-02: a new tool, and a request that makes none", () => {
    const empty = state(null);
    const made = state("w1", list);
    expect(
      checkFacts(empty, made, { claim: "created" }, { created: true, workspace: "new" }),
    ).toEqual([]);
    expect(checkFacts(empty, empty, none, { created: true })).toEqual(["No tool was created."]);
    expect(checkFacts(empty, made, { claim: "created" }, { created: false })).toEqual([
      "A tool was created: Shopping list.",
    ]);
  });

  it("EVAL-02: the open tool's version and data, each changed or unchanged as expected", () => {
    const before = state("w1", list, notes);
    const styled = state("w1", { ...list, version: "v2" }, notes);
    const added = state("w1", { ...list, dataHash: "d2" }, notes);
    const changed: StepOutcome = { claim: "changed" };
    expect(checkFacts(before, styled, changed, { version: "new", data: "unchanged" })).toEqual([]);
    expect(checkFacts(before, added, changed, { version: "unchanged", data: "changed" })).toEqual(
      [],
    );
    expect(checkFacts(before, added, changed, { version: "new", data: "unchanged" })).toEqual([
      "The tool didn't change.",
      "The data changed.",
    ]);
    expect(checkFacts(before, before, none, { workspace: "same" })).toEqual([]);
  });

  it("EVAL-02: data kept allows added fields and items, not a changed or lost value", () => {
    const items = [
      { id: "a", name: "milk" },
      { id: "b", name: "eggs" },
    ];
    const at = (data: unknown, version = "v1") =>
      state("w1", { ...list, version, dataHash: JSON.stringify(data), data }, notes);
    const before = at({ items });
    const changed: StepOutcome = { claim: "changed" };
    const kept = { version: "new", data: "kept" } as const;
    // The M2 live run's T1 step 2: grouping by aisle added an empty aisle to every item.
    const grouped = at({ items: items.map((i) => ({ ...i, aisle: "" })).reverse() }, "v2");
    expect(checkFacts(before, grouped, changed, kept)).toEqual([]);
    expect(checkFacts(before, at({ items }, "v2"), changed, kept)).toEqual([]);
    // Overlapping matches, in either order: each earlier item still finds its own later one.
    const milk = { name: "milk" };
    const dairy = { name: "milk", aisle: "dairy" };
    const other = { name: "milk", aisle: "other" };
    const both = at({ items: [milk, dairy] });
    expect(checkFacts(both, at({ items: [dairy, other] }, "v2"), changed, kept)).toEqual([]);
    expect(checkFacts(both, at({ items: [other, dairy] }, "v2"), changed, kept)).toEqual([]);
    expect(checkFacts(both, at({ items: [other, other] }, "v2"), changed, kept)).toEqual([
      "Some of the earlier data is gone or changed.",
    ]);
    const renamed = at({ items: [items[0], { id: "b", name: "bread" }] }, "v2");
    expect(checkFacts(before, renamed, changed, kept)).toEqual([
      "Some of the earlier data is gone or changed.",
    ]);
    expect(checkFacts(before, at({ items: [items[0]] }, "v2"), changed, kept)).toEqual([
      "Some of the earlier data is gone or changed.",
    ]);
    expect(checkFacts(before, at({}, "v2"), changed, kept)).toEqual([
      "Some of the earlier data is gone or changed.",
    ]);
  });

  it("EVAL-02: nothing unrelated changes, and no success is claimed that wasn't applied (GEN-08)", () => {
    const before = state("w1", list, notes);
    const elsewhere = state("w1", { ...list, version: "v2" }, { ...notes, dataHash: "e2" });
    expect(checkFacts(before, elsewhere, { claim: "changed" })).toEqual([
      "Notes changed, though the step wasn't about it.",
    ]);
    expect(checkFacts(before, before, { claim: "changed" })).toEqual([
      "The host said the tool changed, but nothing stored changed.",
    ]);
    expect(checkFacts(state(null), state(null), { claim: "created" })).toEqual([
      "The host said a tool was made, but none was stored.",
    ]);
  });

  it("EVAL-02, GEN-18: a saved tool offered by name, then Use again and Continue", () => {
    const fresh = { id: "w3", title: "New chat", version: null, dataHash: "x" };
    const asking = state("w3", list, fresh);
    const offered: StepOutcome = { claim: "none", offered: "s1" };
    expect(
      checkFacts(asking, asking, offered, {
        offered: "saved",
        savedTool: "Weekly shopping",
        created: false,
      }),
    ).toEqual([]);
    expect(checkFacts(asking, asking, none, { offered: "saved" })).toEqual([
      "No saved tool was offered.",
    ]);
    expect(checkFacts(asking, asking, offered)).toEqual([
      "A saved tool was offered when none was expected.",
    ]);
    const target = { savedTool: "Weekly shopping" };
    const again = state("w4", list, fresh, { ...list, id: "w4", title: "Weekly shopping" });
    expect(checkFacts(asking, again, none, { workspace: "new" }, target)).toEqual([]);
    expect(
      checkFacts(again, state("w1", ...again.workspaces), none, { workspace: "original" }, target),
    ).toEqual([]);
    // Continue must open the named entry's workspace as it was before the step (DATA-07).
    expect(checkFacts(again, again, none, { workspace: "original" }, target)).toEqual([
      "The saved tool's own workspace isn't open.",
    ]);
  });

  it("EVAL-02, DATA-07: a Use again that moves the entry's Continue is caught, and so is a Continue to it", () => {
    const fresh = { id: "w4", title: "Weekly shopping", version: "v1", dataHash: "d0" };
    const before = state("w1", list);
    const retargeted: HostState = {
      ...state("w4", list, fresh),
      savedTools: [{ id: "s1", name: "Weekly shopping", workspaceId: "w4" }],
    };
    const target = { savedTool: "Weekly shopping" };
    expect(checkFacts(before, retargeted, none, { workspace: "new" }, target)).toEqual([
      "Weekly shopping's Continue now opens a different workspace.",
    ]);
    // A later Continue that opens the moved link still fails against the entry's link before it.
    const later = { ...retargeted, open: "w4" };
    expect(checkFacts(before, later, none, { workspace: "original" }, target)).toContain(
      "The saved tool's own workspace isn't open.",
    );
    expect(checkFacts(before, state("w1", list), none, { workspace: "original" })).toEqual([
      "There was no saved tool named (none named).",
    ]);
  });

  it("EVAL-02, GEN-01: a tool made in the empty workspace that was open counts as made", () => {
    const empty = { id: "w1", title: "New chat", version: null, dataHash: "x" };
    const before = state("w1", empty);
    const after = state("w1", { ...empty, title: "Shopping list", version: "v1" });
    expect(checkFacts(before, after, { claim: "created" }, { created: true })).toEqual([]);
    expect(checkFacts(before, after, none, { created: false })).toEqual([
      "A tool was created: Shopping list.",
    ]);
  });

  it("EVAL-02: a workspace or saved tool that goes away unasked is caught; a delete may take them", () => {
    const before = state("w1", list, notes);
    const lost = state("w1", list);
    expect(checkFacts(before, lost, none, { version: "unchanged", data: "unchanged" })).toEqual([
      "Notes is gone, though the step wasn't about it.",
    ]);
    expect(checkFacts(before, lost, none, {}, { trashes: "w2" })).toEqual([]);
    expect(checkFacts(before, before, none, {}, { trashes: "w2" })).toEqual([
      "The workspace to delete is still there.",
    ]);
    // A saved tool goes only with its workspace (DATA-09).
    const noEntry = { ...before, savedTools: [] };
    expect(checkFacts(before, noEntry, none)).toEqual(["The saved tool Weekly shopping is gone."]);
    expect(
      checkFacts(before, { ...state(null, notes), savedTools: [] }, none, {}, { trashes: "w1" }),
    ).toEqual([]);
  });

  it("EVAL-02: a delete excuses only the one workspace it targets, even when another has its title", () => {
    // Use again names a new workspace after its saved tool, so titles repeat.
    const twin = { ...list, id: "w3" };
    const before: HostState = {
      ...state("w1", list, twin),
      savedTools: [
        { id: "s1", name: "Weekly shopping", workspaceId: "w1" },
        { id: "s2", name: "Party shopping", workspaceId: "w3" },
      ],
    };
    const bothGone: HostState = { workspaces: [], savedTools: [], open: null };
    expect(checkFacts(before, bothGone, none, {}, { trashes: "w1" })).toEqual([
      "Shopping list is gone, though the step wasn't about it.",
      "The saved tool Party shopping is gone.",
    ]);
  });

  it("EVAL-02: an answer instead of a tool", () => {
    const empty = state(null);
    expect(
      checkFacts(empty, empty, { claim: "none", answer: "clarify" }, { answer: "clarify" }),
    ).toEqual([]);
    expect(checkFacts(empty, empty, none, { answer: "unsupported" })).toEqual([
      "The host didn't answer unsupported.",
    ]);
  });
});
