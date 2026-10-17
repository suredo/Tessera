// Tests for scripts/okf-check.mjs (ENG-08, ENG-24), on Node's built-in test runner.
// Run: node --test scripts/okf-check.test.mjs (after pnpm install: the checker reads YAML and TypeScript)
// Each test builds a small throwaway repository with a copy of the checker, then breaks one thing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(SCRIPTS, "okf-check.mjs");
const SYMBOLS = (lines) =>
  [
    "",
    "# Symbols (generated)",
    "",
    "Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.",
    "",
    ...lines,
    "",
  ].join("\n");
const GENERATED = "generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:00:00Z }";
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

const concept = (type, title, description, extra = "", body = "") =>
  [
    "---",
    `type: ${type}`,
    `title: "${title}"`,
    `description: "${description}"`,
    "status: draft",
    GENERATED,
    ...(extra ? [extra] : []),
    "---",
    `# ${title}`,
    body,
  ].join("\n");

const write = (root, p, text) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), text);
};
const read = (root, p) => fs.readFileSync(path.join(root, p), "utf8");
const edit = (root, p, from, to) => {
  const text = read(root, p);
  assert.ok(text.includes(from), `fixture text not found in ${p}: ${from}`);
  write(root, p, text.replace(from, to));
};
const check = (root, ...args) => {
  const r = spawnSync(process.execPath, ["scripts/okf-check.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout + r.stderr };
};
const git = (root, ...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );

// A minimal valid repository: the rules files, a spec row, an engineering rule, and one code doc with its back-link.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-check-"));
  roots.push(root);
  const files = {
    "scripts/okf-check.mjs": fs.readFileSync(CHECKER, "utf8"),
    "scripts/okf-lib.mjs": fs.readFileSync(path.join(SCRIPTS, "okf-lib.mjs"), "utf8"),
    ".gitignore": "node_modules/\n", // the linked workspace dependencies below are never committed
    "AGENTS.md": "# Rules for AI assistants\n",
    "CLAUDE.md": "@AGENTS.md\n",
    "docs/index.md":
      '---\nokf_version: "0.2"\n---\n\n# Docs\n\n* [Spec](spec/index.md) - Requirements.\n* [Practices](practices/index.md) - Rules.\n* [Code](code/index.md) - Code docs.\n',
    "docs/log.md": "# Documentation log\n\n## 2026-10-11\n\n* **Creation**: Fixture.\n",
    "docs/spec/index.md": "# Spec\n\n* [Data](data.md) - Data rules.\n",
    "docs/spec/data.md": concept(
      "Requirement Area",
      "Data",
      "Data rules.",
      "",
      "\n| ID | Requirement |\n| --- | --- |\n| DATA-11 | Assets. |\n",
    ),
    "docs/practices/index.md": "# Practices\n\n* [Code standards](code.md) - Code rules.\n",
    "docs/practices/code.md": concept(
      "Practice",
      "Code standards",
      "Code rules.",
      "",
      "\n| ID | Rule |\n| --- | --- |\n| ENG-18 | Storage migrations. |\n",
    ),
    "docs/code/index.md": "# Code\n\n* [Server](server/index.md) - Server docs.\n",
    "docs/code/server/index.md": "# Server\n\n* [Asset store](assets.md) - Stores files by hash.\n",
    "docs/code/server/assets.md": concept(
      "Code Module",
      "Asset store",
      "Stores files by hash.",
      "resource: ../../../packages/server/src/assets/\nimplements: [DATA-11]",
      SYMBOLS(["- `index.ts`: `putAsset`"]),
    ),
    "packages/server/src/assets/index.ts":
      "// Docs: docs/code/server/assets.md\nexport const putAsset = () => 1;\n",
  };
  for (const [p, text] of Object.entries(files)) write(root, p, text);
  // The checker's own dependencies (yaml, typescript) come from the workspace.
  fs.symlinkSync(
    path.join(SCRIPTS, "..", "node_modules"),
    path.join(root, "node_modules"),
    "junction",
  );
  return root;
}

test("a valid bundle passes", () => {
  const r = check(makeRepo());
  assert.equal(r.code, 0, r.out);
});

test("code docs may implement engineering rules (ENG-*) as well as spec requirements", () => {
  const root = makeRepo();
  edit(
    root,
    "docs/code/server/assets.md",
    "implements: [DATA-11]",
    "implements: [DATA-11, ENG-18]",
  );
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("unknown requirement IDs and missing test paths fail", () => {
  const root = makeRepo();
  edit(
    root,
    "docs/code/server/assets.md",
    "implements: [DATA-11]",
    "implements: [FOO-99]\ntests: [../../../packages/server/test/missing.test.ts]",
  );
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /implements unknown requirement FOO-99/);
  assert.match(r.out, /test not found/);
});

test("escaped quotes inside a quoted flow-map value keep it one value", () => {
  const root = makeRepo();
  edit(
    root,
    "docs/spec/data.md",
    "status: draft",
    String.raw`status: draft
sources:
  - { id: q, resource: https://example.com/q, title: "A \"first, second\" source" }`,
  );
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("unknown types and unquoted values containing ': ' fail", () => {
  const root = makeRepo();
  edit(root, "docs/practices/code.md", "type: Practice", "type: Pratice");
  edit(root, "docs/spec/data.md", 'title: "Data"', "title: Data: rules");
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /unknown type "Pratice"/);
  assert.match(r.out, /data\.md: frontmatter is not valid YAML \(quote values that contain ": "\)/);
});

test("index entries must match frontmatter; --fix repairs them and never writes 'undefined'", () => {
  const root = makeRepo();
  edit(root, "docs/spec/data.md", 'description: "Data rules."', 'description: "Rules for data."');
  let r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /entry for data.md differs/);
  check(root, "--fix");
  assert.equal(check(root).code, 0);
  assert.match(read(root, "docs/spec/index.md"), /^\* \[Data\]\(data\.md\) - Rules for data\.$/m);

  edit(root, "docs/spec/data.md", 'description: "Rules for data."\n', "");
  r = check(root, "--fix");
  assert.equal(r.code, 1);
  assert.match(r.out, /missing "description"/);
  assert.doesNotMatch(read(root, "docs/spec/index.md"), /undefined/);
});

test("links must resolve and be relative, and footnotes need a matching source", () => {
  const root = makeRepo();
  fs.appendFileSync(
    path.join(root, "docs/spec/data.md"),
    "\nSee [x](missing.md), [y](/spec/data.md) and a claim.[^nosuch]\n",
  );
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /broken link: missing\.md/);
  assert.match(r.out, /use a relative link, not \/spec\/data\.md/);
  assert.match(r.out, /footnote \[\^nosuch\] has no matching sources id/);
});

test("links written inside code are ignored", () => {
  const root = makeRepo();
  fs.appendFileSync(
    path.join(root, "docs/spec/data.md"),
    "\nEntries look like `* [title](file.md) - description`.\n",
  );
  assert.equal(check(root).code, 0);
});

test("log dates must be newest first, and every folder needs an index", () => {
  const root = makeRepo();
  fs.appendFileSync(path.join(root, "docs/log.md"), "\n## 2026-10-12\n\n* Later.\n");
  write(root, "docs/extra/x.md", concept("Lesson", "X", "An extra doc."));
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /entries must be newest first/);
  assert.match(r.out, /docs\/extra: folder has no index\.md/);
});

test("stale_after in the past is a warning, not an error", () => {
  const root = makeRepo();
  edit(
    root,
    "docs/spec/data.md",
    "status: draft",
    "status: draft\nstale_after: 2026-01-01T00:00:00Z",
  );
  const r = check(root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /warning .*stale since 2026-01-01/);
});

test("code docs need a Docs: back-link, and Docs: comments must point to real docs", () => {
  const root = makeRepo();
  write(root, "packages/server/src/assets/index.ts", "export const putAsset = () => 1;\n");
  write(root, "packages/server/src/assets/other.ts", "// Docs: docs/code/server/nope.md\n");
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /no code file names this doc/);
  assert.match(r.out, /points to a missing doc: docs\/code\/server\/nope\.md/);
});

test("a script's Docs: comment back-links its doc, and test files are not read for them", () => {
  const root = makeRepo();
  write(root, "packages/server/src/assets/index.ts", "export const putAsset = () => 1;\n");
  write(root, "scripts/assets.ts", "// Docs: docs/code/server/assets.md\n");
  // A test's sample text is not a back-link, even when it points nowhere.
  write(root, "scripts/test/sample.test.mjs", '"// Docs: docs/code/server/nope.md";\n');
  write(root, "packages/server/test/sample.test.ts", '"// Docs: docs/code/server/nope.md";\n');
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("a code doc without a resource, or with one that doesn't exist, fails (ENG-24)", () => {
  const root = makeRepo();
  edit(root, "docs/code/server/assets.md", "resource: ../../../packages/server/src/assets/\n", "");
  let r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /assets\.md: code docs need a resource/);

  write(
    root,
    "docs/code/server/assets.md",
    concept(
      "Code Module",
      "Asset store",
      "Stores files by hash.",
      "resource: ../../../packages/server/src/blobs/\nimplements: [DATA-11]",
    ),
  );
  r = check(root);
  assert.equal(r.code, 1);
  assert.match(
    r.out,
    /assets\.md: resource not found: \.\.\/\.\.\/\.\.\/packages\/server\/src\/blobs\//,
  );
});

test("CLAUDE.md must contain only @AGENTS.md, and AGENTS.md must exist (ENG-05)", () => {
  const root = makeRepo();
  write(root, "CLAUDE.md", "@AGENTS.md\r\n");
  assert.equal(check(root).code, 0, "Windows line endings still pass");

  write(root, "CLAUDE.md", "@AGENTS.md\n\nAlways run the tests first.\n");
  let r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /CLAUDE\.md: must contain only @AGENTS\.md/);

  fs.rmSync(path.join(root, "CLAUDE.md"));
  fs.rmSync(path.join(root, "AGENTS.md"));
  r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /CLAUDE\.md: missing: CLAUDE\.md must contain only @AGENTS\.md/);
  assert.match(r.out, /AGENTS\.md: missing: AGENTS\.md is the rules file/);
});

test("drift: code changed without its doc fails, unless the doc changes or the pull request says why", () => {
  const root = makeRepo();
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  git(root, "switch", "-qc", "feature");
  // A change inside a function: the exports, and so the generated symbol section, stay the same.
  edit(root, "packages/server/src/assets/index.ts", "() => 1", "() => 2");
  git(root, "commit", "-qam", "code only");

  let r = check(root, "--base", "main");
  assert.equal(r.code, 1);
  assert.match(r.out, /code under packages\/server\/src\/assets changed/);

  write(
    root,
    "pr.txt",
    "Summary\n\nNo doc change needed: docs/code/server/assets.md: changes a return value only\n",
  );
  r = check(root, "--base", "main", "--pr-body", "pr.txt");
  assert.equal(r.code, 0, r.out);

  edit(root, "docs/code/server/assets.md", "status: draft", "status: stable");
  git(root, "commit", "-qam", "doc too");
  r = check(root, "--base", "main");
  assert.equal(r.code, 0, r.out);
});

// ---------- task context (ENG-25, ENG-26) ----------
const today = () => new Date().toISOString().slice(0, 10);
const handoff = (
  id,
  { subject = "spec/data", status = "in-progress", date = today(), extra = "", body = "" } = {},
) =>
  [
    "---",
    `task_id: ${id}`,
    `subject: ${subject}`,
    `status: ${status}`,
    `checkpoint_date: ${date}`,
    ...(extra ? [extra] : []),
    "---",
    "",
    `# Task: ${id}`,
    "",
    "## Authoritative references",
    "- `docs/spec/data.md` — the asset rules",
    "",
    "## Next action",
    "1. Write the store.",
    body,
  ].join("\n");
const historyNote = (subject, id, date = "2026-10-11", status = "historical") =>
  [
    "---",
    `subject: ${subject}`,
    `task_id: ${id}`,
    `date: ${date}`,
    `status: ${status}`,
    "---",
    "",
    "# Rejected: storing images in SQLite",
    "",
    "## Relationship to current knowledge",
    "- Canonical: `docs/spec/data.md`",
  ].join("\n");

test("handoffs and history notes: valid ones pass, and two tasks keep separate files (T7)", () => {
  const root = makeRepo();
  write(root, "context/handoffs/asset-store.md", handoff("asset-store"));
  write(
    root,
    "context/handoffs/code-rules.md",
    handoff("code-rules", { subject: "practices/code", extra: "parent: asset-store" }),
  );
  write(
    root,
    "context/history/spec/data/2026-10-11-asset-store.md",
    historyNote("spec/data", "asset-store"),
  );
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("a handoff's ID, status, subject and size are checked", () => {
  const root = makeRepo();
  write(root, "context/handoffs/asset-store.md", handoff("other-task"));
  write(root, "context/handoffs/done-task.md", handoff("done-task", { status: "complete" }));
  write(root, "context/handoffs/lost-task.md", handoff("lost-task", { subject: "spec/nowhere" }));
  write(root, "context/handoffs/long-task.md", handoff("long-task", { body: "word ".repeat(720) }));
  write(
    root,
    "context/handoffs/wordy-task.md",
    handoff("wordy-task", { body: "word ".repeat(520) }),
  );
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /asset-store\.md: task_id must match the file name/);
  assert.match(r.out, /done-task\.md: remove a finished task's handoff/);
  assert.match(r.out, /lost-task\.md: subject is not a docs path: spec\/nowhere/);
  assert.match(r.out, /long-task\.md: handoff has \d+ words; the limit is 700/);
  assert.match(r.out, /warning .*wordy-task\.md: handoff has \d+ words; aim for 250–500/);
});

test("a stale reference in a handoff is reported, not ignored (T9)", () => {
  const root = makeRepo();
  write(
    root,
    "context/handoffs/asset-store.md",
    handoff("asset-store", {
      body: "\nSee `docs/spec/storage.md` and `docs/spec/data.md#missing-section`.",
    }),
  );
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /reference not found: docs\/spec\/storage\.md/);
  assert.match(r.out, /reference anchor not found: docs\/spec\/data\.md#missing-section/);
});

test("a handoff checkpointed more than 5 days ago is a warning, not an error", () => {
  const root = makeRepo();
  write(root, "context/handoffs/old-task.md", handoff("old-task", { date: "2026-01-01" }));
  write(root, "context/handoffs/fresh-task.md", handoff("fresh-task"));
  const r = check(root);
  assert.equal(r.code, 0, r.out);
  assert.match(
    r.out,
    /warning .*old-task\.md: checkpointed \d+ days ago; refresh it with a checkpoint, or end the task/,
  );
  assert.doesNotMatch(r.out, /fresh-task\.md/);
});

test("--merge-ready fails while a handoff is left, and passes once it is removed", () => {
  const root = makeRepo();
  write(root, "context/handoffs/.gitkeep", "");
  write(root, "context/handoffs/asset-store.md", handoff("asset-store"));
  assert.equal(check(root).code, 0);
  let r = check(root, "--merge-ready");
  assert.equal(r.code, 1);
  assert.match(
    r.out,
    /asset-store\.md: not ready to merge: the last commit of the task's pull request removes its handoff/,
  );
  fs.rmSync(path.join(root, "context/handoffs/asset-store.md"));
  r = check(root, "--merge-ready");
  assert.equal(r.code, 0, r.out);
});

test("history notes sit under their subject, are named <date>-<task_id>.md and are historical", () => {
  const root = makeRepo();
  write(
    root,
    "context/history/spec/data/2026-10-11-asset-store.md",
    historyNote("practices/code", "asset-store"),
  );
  write(root, "context/history/spec/data/notes.md", historyNote("spec/data", "asset-store"));
  write(
    root,
    "context/history/spec/data/2026-10-12-other.md",
    historyNote("spec/data", "other", "2026-10-12", "stable"),
  );
  write(root, "context/scratch.md", "loose notes\n");
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /2026-10-11-asset-store\.md: subject must match its folder \(spec\/data\)/);
  assert.match(r.out, /notes\.md: file name must be <date>-<task_id>\.md/);
  assert.match(r.out, /2026-10-12-other\.md: status must be historical/);
  assert.match(
    r.out,
    /context\/scratch\.md: context\/ holds only README\.md, handoffs\/ and history\//,
  );
});

test("skills need identical Claude Code and Codex adapters with the same invocation policy", () => {
  const root = makeRepo();
  const skill = (extra) =>
    [
      "---",
      "name: task-checkpoint",
      'description: "Checkpoint a task."',
      ...extra,
      "---",
      "",
      "Follow `docs/practices/code.md`.",
      "",
    ].join("\n");
  write(root, ".claude/skills/task-checkpoint/SKILL.md", skill(["disable-model-invocation: true"]));
  write(root, ".agents/skills/task-checkpoint/SKILL.md", skill([]));
  write(
    root,
    ".agents/skills/task-checkpoint/agents/openai.yaml",
    "policy:\n  allow_implicit_invocation: false\n",
  );
  assert.equal(check(root).code, 0, check(root).out);

  write(
    root,
    ".agents/skills/task-checkpoint/SKILL.md",
    skill([]).replace("code.md", "documentation.md"),
  );
  fs.rmSync(path.join(root, ".agents/skills/task-checkpoint/agents"), { recursive: true });
  write(
    root,
    ".claude/skills/task-resume/SKILL.md",
    skill([]).replace("name: task-checkpoint", "name: task-resume"),
  );
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /instructions differ from the Claude Code adapter/);
  assert.match(r.out, /reference not found: docs\/practices\/documentation\.md/);
  assert.match(r.out, /must agree on whether the skill runs only when asked/);
  assert.match(r.out, /\.agents\/skills\/task-resume\/SKILL\.md: missing/);
});

// ---------- symbols in code docs (ENG-24) ----------
const ASSETS_DOC = "docs/code/server/assets.md";
const ASSETS_CODE = "packages/server/src/assets/index.ts";

test("a code doc that names a symbol its code doesn't export fails (ENG-24)", () => {
  const root = makeRepo();
  edit(
    root,
    ASSETS_DOC,
    "# Asset store\n",
    "# Asset store\n\n# Entry points\n\n- `index.ts`: `putAsset` and `getAsset`\n",
  );
  let r = check(root);
  assert.equal(r.code, 1);
  assert.match(
    r.out,
    /assets\.md: names `getAsset` under Entry points, which packages\/server\/src\/assets doesn't export/,
  );
  assert.doesNotMatch(r.out, /names `putAsset`/);

  fs.appendFileSync(path.join(root, ASSETS_CODE), "export const getAsset = () => 2;\n");
  r = check(root, "--fix");
  assert.equal(r.code, 0, r.out);
});

test("test code (unit, e2e, spec) is not listed among a doc's symbols (ENG-24)", () => {
  const root = makeRepo();
  write(root, "packages/server/src/assets/e2e/prune.ts", "export default function prune() {}\n");
  write(root, "packages/server/src/assets/store.spec.ts", "export const fixture = 1;\n");
  write(root, "packages/server/src/assets/store.test.ts", "export const sample = 1;\n");
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("the generated symbol section follows the code, and --fix rewrites it (ENG-24)", () => {
  const root = makeRepo();
  fs.appendFileSync(
    path.join(root, ASSETS_CODE),
    "export type Asset = { hash: string };\nexport { putAsset as storeAsset };\n",
  );
  let r = check(root);
  assert.equal(r.code, 1);
  assert.match(
    r.out,
    /assets\.md: the "# Symbols \(generated\)" section is out of date; run node scripts\/okf-check\.mjs --fix/,
  );

  r = check(root, "--fix");
  assert.equal(r.code, 0, r.out);
  assert.ok(
    read(root, ASSETS_DOC).endsWith("- `index.ts`: `putAsset`, `Asset` (type), `storeAsset`\n"),
  );
  assert.equal(check(root, "--fix").code, 0);
  assert.ok(
    read(root, ASSETS_DOC).endsWith("- `index.ts`: `putAsset`, `Asset` (type), `storeAsset`\n"),
    "a second --fix changes nothing",
  );

  write(
    root,
    ASSETS_DOC,
    concept(
      "Code Module",
      "Asset store",
      "Stores files by hash.",
      "resource: ../../../packages/server/src/assets/\nimplements: [DATA-11]",
    ),
  );
  r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /assets\.md: the "# Symbols \(generated\)" section is missing/);
});

test("destructured and namespace exports count, under Entry points and in the generated section (ENG-24)", () => {
  const root = makeRepo();
  write(root, "packages/server/src/assets/helpers.ts", "export const help = 1;\n");
  fs.appendFileSync(
    path.join(root, ASSETS_CODE),
    'export const { read, write: save, ...rest } = { read: 1, write: 2, keep: 3 };\nexport const [first, , third] = [1, 2, 3];\nexport * as helpers from "./helpers.ts";\n',
  );
  edit(
    root,
    ASSETS_DOC,
    "# Asset store\n",
    "# Asset store\n\n# Entry points\n\n- `index.ts`: `read`, `save`, `rest`, `first`, `third` and `helpers`\n",
  );
  const r = check(root, "--fix");
  assert.equal(r.code, 0, r.out);
  assert.ok(
    read(root, ASSETS_DOC).endsWith(
      "- `helpers.ts`: `help`\n- `index.ts`: `putAsset`, `read`, `save`, `rest`, `first`, `third`, `helpers`\n",
    ),
    read(root, ASSETS_DOC),
  );
  assert.equal(check(root).code, 0);
});

// ---------- the YAML library reads the docs as the old parser did (ENG-08) ----------
// A frozen copy of the subset parser the check used before it read frontmatter with a YAML library.
function legacySplitTop(s) {
  const parts = [];
  let depth = 0,
    quote = null,
    escaped = false,
    cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (escaped) escaped = false;
      else if (ch === "\\" && quote === '"') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function legacyParseValue(v) {
  v = v.trim();
  if (v.startsWith("[")) return legacySplitTop(v.slice(1, -1)).map(legacyParseValue);
  if (v.startsWith("{")) {
    const o = {};
    for (const part of legacySplitTop(v.slice(1, -1))) {
      const k = part.indexOf(": ");
      o[part.slice(0, k).trim()] = legacyParseValue(part.slice(k + 2));
    }
    return o;
  }
  if (v.startsWith('"')) return JSON.parse(v);
  if (v.startsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function legacyParseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { fm: null, body: text };
  const end = text.indexOf("\n---\n", 3);
  const lines = text.slice(4, end).split("\n");
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const [, key, rest] = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (rest) {
      fm[key] = legacyParseValue(rest);
      continue;
    }
    const items = [];
    while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]))
      items.push(legacyParseValue(lines[++i].replace(/^\s+-\s+/, "")));
    fm[key] = items;
  }
  return { fm, body: text.slice(end + 5) };
}

test("the YAML library reads every doc in this repository as the old subset parser did (ENG-08)", async () => {
  const { parseFrontmatter } = await import("./okf-lib.mjs");
  const repo = path.join(SCRIPTS, "..");
  const markdown = (dir) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((e) =>
            e.isDirectory()
              ? markdown(path.join(dir, e.name))
              : e.name.endsWith(".md")
                ? [path.join(dir, e.name)]
                : [],
          )
      : [];
  const files = ["docs", "context", ".claude/skills", ".agents/skills"].flatMap((d) =>
    markdown(path.join(repo, d)),
  );
  // The old parser kept every scalar as text; YAML reads `true` as a boolean. Compare as text.
  const asText = (v) =>
    Array.isArray(v)
      ? v.map(asText)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asText(x)]))
        : String(v);
  let withFrontmatter = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    const before = legacyParseFrontmatter(text);
    const now = parseFrontmatter(text);
    assert.deepEqual(asText(now.fm), asText(before.fm), path.relative(repo, f));
    assert.equal(now.body, before.body, path.relative(repo, f));
    if (now.fm) withFrontmatter++;
  }
  assert.ok(withFrontmatter > 60, `only ${withFrontmatter} docs with frontmatter found`);
});
