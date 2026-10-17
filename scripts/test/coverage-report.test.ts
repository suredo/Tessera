// Tests for the coverage report (ENG-17), on small fixture repositories built in a temporary folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { collect, render } from "../coverage-report.ts";

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** A repository with the given files, each path relative to its root. */
function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-coverage-"));
  temps.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

const codeDoc = (implementsIds: string[], tests: string[]) =>
  `---\ntype: Code Module\nimplements: [${implementsIds.join(", ")}]\ntests: [${tests.join(", ")}]\n---\n# Purpose\n`;

const base = {
  "docs/spec/area.md":
    "| ID | Requirement |\n| --- | --- |\n| AREA-01 | One. |\n| AREA-02 | Two. |\n| AREA-03 | Three. |\n| AREA-04 | Four. |\n",
  "docs/practices/rules.md":
    "| ID | Rule |\n| --- | --- |\n| ENG-01 | A rule. |\n| ENG-02 | Another. |\n",
  "docs/roadmap/m0-first.md":
    "| Deliverable | Requirements |\n| --- | --- |\n| A | AREA-01, AREA-02, ENG-02 |\n",
  "docs/roadmap/m2-later.md": "| Deliverable | Requirements |\n| --- | --- |\n| B | AREA-03 |\n",
  "docs/lessons/catalogue.md":
    "| ID | What happened | Root cause | Mitigation | Status |\n| --- | --- | --- | --- | --- |\n| L-01 | x | y | AREA-01, ENG-01 | D |\n| L-02 | x | y | AREA-01, AREA-03 | R |\n| L-03 | x | y | none | A |\n",
  "docs/code/pkg/mod.md": codeDoc(["AREA-01", "AREA-03"], ["../../../pkg/test/mod.test.ts"]),
  "pkg/test/mod.test.ts":
    'describe("module (AREA-01)", () => {\n  it("does the later thing (AREA-03)", () => {});\n});\n',
  "pkg/test/other.test.ts":
    'it(\n  "names a requirement nothing implements (AREA-02)",\n  () => {},\n);\n',
};

describe("coverage report (ENG-17)", () => {
  it("calls a requirement verified only when its code doc's own tests name it", () => {
    const c = collect(repo(base), "M0");
    const status = (id: string) => c.requirements.find((r) => r.id === id);
    expect(status("AREA-01")).toMatchObject({
      status: "verified",
      milestone: "M0",
      counted: true,
      implementedBy: ["docs/code/pkg/mod.md"],
      namedIn: ["pkg/test/mod.test.ts"],
    });
    // A test name alone is a link, not proof.
    expect(status("AREA-02")).toMatchObject({
      status: "proposed",
      namedIn: ["pkg/test/other.test.ts"],
      limits: ["named in tests only, not proof"],
    });
  });

  it("never counts work due in a later milestone as resolved, even when verified", () => {
    const c = collect(repo(base), "M0");
    expect(c.requirements.find((r) => r.id === "AREA-03")).toMatchObject({
      status: "verified",
      milestone: "M2",
      counted: false,
      limits: ["deferred to M2"],
    });
    expect(collect(repo(base), "M2").requirements.find((r) => r.id === "AREA-03")?.counted).toBe(
      true,
    );
    const text = render(c);
    // Due by M0: AREA-01 (verified), AREA-02, and the practices ENG-01 and ENG-02.
    expect(text).toContain("| Requirements due by M0 | 4 | 1 | 0 | 3 |");
    expect(text).toContain("| Requirements due later (not counted) | 2 | 1 | 0 | 1 |");
  });

  it("counts a practice from the start, and a spec requirement only once it is scheduled", () => {
    const c = collect(repo(base), "M0");
    expect(c.requirements.find((r) => r.id === "ENG-01")).toMatchObject({
      milestone: null,
      counted: true,
      limits: ["a working rule: followed in review, no code evidence"],
    });
    expect(c.requirements.find((r) => r.id === "AREA-04")).toMatchObject({
      counted: false,
      limits: ["in no milestone"],
    });
  });

  it("gives a lesson its least advanced mitigation's status and its latest milestone", () => {
    const c = collect(repo(base), "M0");
    const lesson = (id: string) => c.lessons.find((l) => l.id === id);
    expect(lesson("L-01")).toMatchObject({ status: "proposed", milestone: "M0", counted: true });
    expect(lesson("L-02")).toMatchObject({
      classification: "R",
      status: "verified",
      milestone: "M2",
      counted: false,
      limits: ["residual risk: depends on the model", "waits on AREA-03"],
    });
    expect(lesson("L-03")).toMatchObject({ status: "accepted", counted: true });
  });

  it("reports IDs that nothing defines, in test names, code docs and lesson mitigations", () => {
    const c = collect(
      repo({
        ...base,
        "docs/code/pkg/typo.md": codeDoc(["AREA-09"], []),
        "pkg/test/typo.test.ts": 'it("checks a thing (AREA-07), not SHA-256", () => {});\n',
        "docs/lessons/more.md":
          "| ID | What happened | Root cause | Mitigation | Status |\n| --- | --- | --- | --- | --- |\n| L-04 | x | y | ENG-99 | D |\n",
      }),
      "M0",
    );
    expect(c.unknownIds.map((u) => u.id).sort()).toEqual(["AREA-07", "AREA-09", "ENG-99"]);
    expect(render(c)).toContain("## Unknown IDs");
  });

  it("finds no unknown ID in this repository", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    expect(collect(root, "M0").unknownIds).toEqual([]);
  });
});
