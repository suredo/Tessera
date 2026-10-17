// Docs: docs/code/scripts/coverage-report.md
// The requirement and lesson coverage report (ENG-17): every requirement and lesson with its
// milestone, status, evidence and remaining limits. Run: pnpm coverage (the current milestone is
// set there). It fails on IDs that nothing defines.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter } from "./okf-lib.mjs";

export const MILESTONES = ["M0", "M1", "M2", "M3", "M4", "M5", "M6"] as const;
export type Milestone = (typeof MILESTONES)[number];
export type Status = "verified" | "implemented" | "proposed";

export type Requirement = {
  id: string;
  /** The spec or practice file that defines it. */
  source: string;
  /** The earliest milestone whose deliverables list it; null when none does. */
  milestone: Milestone | null;
  /** Code docs whose `implements` names it. */
  implementedBy: string[];
  /** Test files with a test name that names it. A link, not proof on its own. */
  namedIn: string[];
  status: Status;
  /** Whether it counts toward the current milestone's closure. */
  counted: boolean;
  limits: string[];
};

export type Lesson = {
  id: string;
  /** The catalogue's class: D (structural control), R (risk reduction) or A (accepted). */
  classification: string;
  mitigations: string[];
  milestone: Milestone | null;
  status: Status | "accepted" | "no mitigation";
  counted: boolean;
  limits: string[];
};

export type Coverage = {
  milestone: Milestone;
  requirements: Requirement[];
  lessons: Lesson[];
  /** IDs used in test names, code docs or lesson mitigations that nothing defines. */
  unknownIds: { id: string; where: string }[];
};

const STATUS_ORDER: Status[] = ["proposed", "implemented", "verified"];
const SKIP = new Set(["node_modules", ".git", "dist", "test-output", "coverage"]);

const read = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const slash = (p: string) => p.split(path.sep).join("/");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : walk(p);
    return [p];
  });
}

/** The rows of every Markdown table in a text, as cells keyed by the table's header. */
function tables(text: string): Record<string, string>[] {
  const lines = text.split("\n");
  const rows: Record<string, string>[] = [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i]?.startsWith("|") || !/^\|\s*-{3}/.test(lines[i + 1] ?? "")) continue;
    const header = cells(lines[i] ?? "");
    let j = i + 2;
    for (; lines[j]?.startsWith("|"); j++) {
      const row = cells(lines[j] ?? "");
      rows.push(Object.fromEntries(header.map((h, k) => [h, row[k] ?? ""])));
    }
    i = j - 1;
  }
  return rows;
}

const idsIn = (text: string, prefixes: Set<string>): string[] =>
  [...text.matchAll(/\b([A-Z]{1,5})-(\d{2,3})\b/g)]
    .filter((m) => prefixes.has(m[1] ?? ""))
    .map((m) => m[0]);

// Test titles: the first string argument of it(), test() and describe(), with .skip and the like.
const TITLE = /\b(?:it|test|describe)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Collects the coverage of every requirement and lesson in the repository at `root`. */
export function collect(root: string, current: Milestone): Coverage {
  const docs = path.join(root, "docs");
  const rel = (p: string) => slash(path.relative(root, p));

  // Requirements: the first column of the spec's and the practices' tables.
  const defined = new Map<string, string>();
  for (const area of ["spec", "practices"]) {
    for (const file of walk(path.join(docs, area)).filter((f) => f.endsWith(".md"))) {
      for (const m of read(file).matchAll(/^\| ([A-Z]+-\d+) \|/gm)) {
        if (m[1] && !defined.has(m[1])) defined.set(m[1], rel(file));
      }
    }
  }
  const prefixes = new Set([...defined.keys()].map((id) => id.split("-")[0] ?? ""));
  prefixes.add("L");

  // Lessons: rows of the lessons' tables, with their Mitigation and Status columns.
  const lessonRows = walk(path.join(docs, "lessons"))
    .filter((f) => f.endsWith(".md"))
    .flatMap((file) => tables(read(file)).map((row) => ({ row, file: rel(file) })))
    .filter(({ row }) => /^L-\d+$/.test(row["ID"] ?? ""));
  const lessonIds = new Set(lessonRows.map(({ row }) => row["ID"] ?? ""));
  const unknownIds: Coverage["unknownIds"] = [];
  const check = (id: string, where: string) => {
    if (!defined.has(id) && !lessonIds.has(id)) unknownIds.push({ id, where });
  };

  // Milestones: the IDs in each milestone's tables; the earliest milestone wins.
  const milestoneOf = new Map<string, Milestone>();
  for (const [index, milestone] of MILESTONES.entries()) {
    const file = walk(path.join(docs, "roadmap")).find((f) =>
      path.basename(f).startsWith(`m${index}-`),
    );
    if (!file) continue;
    for (const line of read(file)
      .split("\n")
      .filter((l) => l.startsWith("|"))) {
      for (const id of idsIn(line, prefixes)) {
        if (defined.has(id) && !milestoneOf.has(id)) milestoneOf.set(id, milestone);
      }
    }
  }

  // Code docs: what each implements, and the test files it lists.
  const codeDocs = walk(path.join(docs, "code"))
    .filter((f) => f.endsWith(".md") && path.basename(f) !== "index.md")
    .map((file) => {
      // The shared helper is plain JavaScript; frontmatter is a set of keys or null.
      const { fm } = parseFrontmatter(read(file)) as { fm: Record<string, unknown> | null };
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
      return {
        doc: rel(file),
        implements: list(fm?.["implements"]),
        tests: list(fm?.["tests"]).map((t) => rel(path.resolve(path.dirname(file), t))),
      };
    });
  for (const d of codeDocs) d.implements.forEach((id) => check(id, d.doc));

  // Test names: which test files name which IDs.
  const namedIn = new Map<string, Set<string>>();
  const testFiles = walk(root).filter((f) => /\.(test|spec)\.(tsx?|mjs)$/.test(f));
  for (const file of testFiles) {
    for (const m of read(file).matchAll(TITLE)) {
      for (const id of idsIn(m[2] ?? "", prefixes)) {
        check(id, rel(file));
        if (!namedIn.has(id)) namedIn.set(id, new Set());
        namedIn.get(id)?.add(rel(file));
      }
    }
  }

  const reached = (m: Milestone | null) =>
    m !== null && MILESTONES.indexOf(m) <= MILESTONES.indexOf(current);

  const requirements: Requirement[] = [...defined.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([id, source]) => {
      const implementing = codeDocs.filter((d) => d.implements.includes(id));
      const named = [...(namedIn.get(id) ?? [])].sort();
      const verified = implementing.some((d) => d.tests.some((t) => named.includes(t)));
      const status: Status = verified
        ? "verified"
        : implementing.length
          ? "implemented"
          : "proposed";
      const milestone = milestoneOf.get(id) ?? null;
      // A practice applies from the start; a spec requirement counts once its milestone is reached.
      const always = source.startsWith("docs/practices/") && milestone === null;
      const counted = always || reached(milestone);
      const limits: string[] = [];
      if (milestone !== null && !reached(milestone)) limits.push(`deferred to ${milestone}`);
      if (milestone === null && !always) limits.push("in no milestone");
      if (status === "proposed" && named.length) limits.push("named in tests only, not proof");
      if (status === "proposed" && !named.length && always) {
        limits.push("a working rule: followed in review, no code evidence");
      }
      if (status === "implemented") limits.push("no test of its code doc names it");
      return {
        id,
        source,
        milestone,
        implementedBy: implementing.map((d) => d.doc),
        namedIn: named,
        status,
        counted,
        limits,
      };
    });
  const byId = new Map(requirements.map((r) => [r.id, r]));

  const lessons: Lesson[] = lessonRows
    .map(({ row, file }) => {
      const id = row["ID"] ?? "";
      const mitigations = [...new Set(idsIn(row["Mitigation"] ?? "", prefixes))];
      mitigations.forEach((m) => check(m, `${file} (${id})`));
      const known = mitigations.flatMap((m) => byId.get(m) ?? []);
      const classification = (row["Status"] ?? "").trim();
      const limits: string[] = [];
      if (classification === "R") limits.push("residual risk: depends on the model");
      if (!known.length) {
        return {
          id,
          classification,
          mitigations,
          milestone: null,
          status: classification === "A" ? ("accepted" as const) : ("no mitigation" as const),
          counted: classification === "A",
          limits,
        };
      }
      // A lesson is only as far along as its least advanced mitigation, and waits for the last.
      const status = STATUS_ORDER[Math.min(...known.map((r) => STATUS_ORDER.indexOf(r.status)))];
      // Practices apply from the start, so only scheduled mitigations set the lesson's milestone.
      const scheduled = known.flatMap((r) =>
        r.milestone ? [MILESTONES.indexOf(r.milestone)] : [],
      );
      const latest = scheduled.length ? (MILESTONES[Math.max(...scheduled)] ?? null) : null;
      const counted = known.every((r) => r.counted);
      const waiting = known.filter((r) => !r.counted).map((r) => r.id);
      if (waiting.length) limits.push(`waits on ${waiting.join(", ")}`);
      return {
        id,
        classification,
        mitigations,
        milestone: latest,
        status: status ?? "proposed",
        counted,
        limits,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  return { milestone: current, requirements, lessons, unknownIds };
}

const cell = (text: string) => text.replaceAll("|", "\\|");
const count = <T>(items: T[], test: (item: T) => boolean) => items.filter(test).length;

/** The report as Markdown, for a CI job summary. */
export function render(c: Coverage): string {
  const now = c.requirements.filter((r) => r.counted);
  const later = c.requirements.filter((r) => !r.counted);
  const lessonsNow = c.lessons.filter((l) => l.counted);
  const summaryRow = (label: string, items: { status: string }[]) =>
    `| ${label} | ${items.length} | ${count(items, (i) => i.status === "verified")} | ${count(items, (i) => i.status === "implemented")} | ${count(items, (i) => i.status === "proposed")} |`;
  const lines = [
    `# Coverage report (${c.milestone})`,
    "",
    `Counted: requirements and lessons due by ${c.milestone}. Work due in a later milestone is listed but never counted as resolved (ENG-17). A test that names an ID is a link, not proof: **verified** needs a code doc that implements the ID and one of that doc's tests naming it.`,
    "",
    "| | Total | Verified | Implemented | Proposed |",
    "| --- | --- | --- | --- | --- |",
    summaryRow(`Requirements due by ${c.milestone}`, now),
    summaryRow("Requirements due later (not counted)", later),
    summaryRow(`Lessons due by ${c.milestone}`, lessonsNow),
    "",
  ];
  if (c.unknownIds.length) {
    lines.push(
      "## Unknown IDs",
      "",
      "These IDs are used but defined nowhere in the spec, the practices or the lessons:",
      "",
      ...c.unknownIds.map((u) => `- ${u.id} in ${u.where}`),
      "",
    );
  }
  lines.push(
    "## Requirements",
    "",
    "| ID | Milestone | Status | Implemented by | Named in tests | Remaining limits |",
    "| --- | --- | --- | --- | --- | --- |",
    ...c.requirements.map(
      (r) =>
        `| ${r.id} | ${r.milestone ?? "-"} | ${r.status} | ${r.implementedBy.join(", ") || "-"} | ${r.namedIn.join(", ") || "-"} | ${cell(r.limits.join("; ")) || "-"} |`,
    ),
    "",
    "## Lessons",
    "",
    "| ID | Class | Mitigation | Milestone | Status | Remaining limits |",
    "| --- | --- | --- | --- | --- | --- |",
    ...c.lessons.map(
      (l) =>
        `| ${l.id} | ${l.classification || "-"} | ${l.mitigations.join(", ") || "-"} | ${l.milestone ?? "-"} | ${l.status} | ${cell(l.limits.join("; ")) || "-"} |`,
    ),
    "",
  );
  return lines.join("\n");
}

function main(argv: string[]): number {
  const at = argv.indexOf("--milestone");
  const milestone = argv[at + 1] as Milestone;
  if (at < 0 || !MILESTONES.includes(milestone)) {
    throw new Error(`Pass --milestone with one of ${MILESTONES.join(", ")}.`);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const coverage = collect(root, milestone);
  const text = render(coverage);
  const out = path.join(root, "test-output", "coverage-report.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) fs.appendFileSync(summary, text);
  const now = coverage.requirements.filter((r) => r.counted);
  console.log(
    `Coverage (${milestone}): ${count(now, (r) => r.status === "verified")} verified, ${count(now, (r) => r.status === "implemented")} implemented, ${count(now, (r) => r.status === "proposed")} proposed of ${now.length} requirements due; report in ${slash(path.relative(root, out))}.`,
  );
  for (const u of coverage.unknownIds) console.error(`unknown ID ${u.id} in ${u.where}`);
  return coverage.unknownIds.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
