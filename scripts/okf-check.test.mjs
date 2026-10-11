// Tests for scripts/okf-check.mjs (ENG-08, ENG-24). Zero dependencies: Node's built-in test runner.
// Run: node --test scripts/okf-check.test.mjs
// Each test builds a small throwaway repository with a copy of the checker, then breaks one thing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "okf-check.mjs");
const GENERATED = "generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:00:00Z }";
const roots = [];
after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

const concept = (type, title, description, extra = "", body = "") =>
  ["---", `type: ${type}`, `title: "${title}"`, `description: "${description}"`, "status: draft", GENERATED, ...(extra ? [extra] : []), "---", `# ${title}`, body].join("\n");

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
  const r = spawnSync(process.execPath, ["scripts/okf-check.mjs", ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};
const git = (root, ...args) =>
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "core.autocrlf=false", ...args], { cwd: root, encoding: "utf8" });

// A minimal valid repository: a spec row, an engineering rule, and one code doc with its back-link.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "okf-check-"));
  roots.push(root);
  const files = {
    "scripts/okf-check.mjs": fs.readFileSync(CHECKER, "utf8"),
    "docs/index.md": '---\nokf_version: "0.2"\n---\n\n# Docs\n\n* [Spec](spec/index.md) - Requirements.\n* [Practices](practices/index.md) - Rules.\n* [Code](code/index.md) - Code docs.\n',
    "docs/log.md": "# Documentation log\n\n## 2026-10-11\n\n* **Creation**: Fixture.\n",
    "docs/spec/index.md": "# Spec\n\n* [Data](data.md) - Data rules.\n",
    "docs/spec/data.md": concept("Requirement Area", "Data", "Data rules.", "", "\n| ID | Requirement |\n| --- | --- |\n| DATA-11 | Assets. |\n"),
    "docs/practices/index.md": "# Practices\n\n* [Code standards](code.md) - Code rules.\n",
    "docs/practices/code.md": concept("Practice", "Code standards", "Code rules.", "", "\n| ID | Rule |\n| --- | --- |\n| ENG-18 | Storage migrations. |\n"),
    "docs/code/index.md": "# Code\n\n* [Server](server/index.md) - Server docs.\n",
    "docs/code/server/index.md": "# Server\n\n* [Asset store](assets.md) - Stores files by hash.\n",
    "docs/code/server/assets.md": concept("Code Module", "Asset store", "Stores files by hash.", "resource: ../../../packages/server/src/assets/\nimplements: [DATA-11]"),
    "packages/server/src/assets/index.ts": "// Docs: docs/code/server/assets.md\nexport const putAsset = () => 1;\n",
  };
  for (const [p, text] of Object.entries(files)) write(root, p, text);
  return root;
}

test("a valid bundle passes", () => {
  const r = check(makeRepo());
  assert.equal(r.code, 0, r.out);
});

test("code docs may implement engineering rules (ENG-*) as well as spec requirements", () => {
  const root = makeRepo();
  edit(root, "docs/code/server/assets.md", "implements: [DATA-11]", "implements: [DATA-11, ENG-18]");
  const r = check(root);
  assert.equal(r.code, 0, r.out);
});

test("unknown requirement IDs and missing test paths fail", () => {
  const root = makeRepo();
  edit(root, "docs/code/server/assets.md", "implements: [DATA-11]", "implements: [FOO-99]\ntests: [../../../packages/server/test/missing.test.ts]");
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /implements unknown requirement FOO-99/);
  assert.match(r.out, /test not found/);
});

test("escaped quotes inside a quoted flow-map value keep it one value", () => {
  const root = makeRepo();
  edit(root, "docs/spec/data.md", "status: draft", String.raw`status: draft
sources:
  - { id: q, resource: https://example.com/q, title: "A \"first, second\" source" }`);
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
  assert.match(r.out, /quote this value: Data: rules/);
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
  fs.appendFileSync(path.join(root, "docs/spec/data.md"), "\nSee [x](missing.md), [y](/spec/data.md) and a claim.[^nosuch]\n");
  const r = check(root);
  assert.equal(r.code, 1);
  assert.match(r.out, /broken link: missing\.md/);
  assert.match(r.out, /use a relative link, not \/spec\/data\.md/);
  assert.match(r.out, /footnote \[\^nosuch\] has no matching sources id/);
});

test("links written inside code are ignored", () => {
  const root = makeRepo();
  fs.appendFileSync(path.join(root, "docs/spec/data.md"), "\nEntries look like `* [title](file.md) - description`.\n");
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
  edit(root, "docs/spec/data.md", "status: draft", "status: draft\nstale_after: 2026-01-01T00:00:00Z");
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

test("drift: code changed without its doc fails, unless the doc changes or the pull request says why", () => {
  const root = makeRepo();
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  git(root, "switch", "-qc", "feature");
  fs.appendFileSync(path.join(root, "packages/server/src/assets/index.ts"), "export const getAsset = () => 2;\n");
  git(root, "commit", "-qam", "code only");

  let r = check(root, "--base", "main");
  assert.equal(r.code, 1);
  assert.match(r.out, /code under packages\/server\/src\/assets changed/);

  write(root, "pr.txt", "Summary\n\nNo doc change needed: docs/code/server/assets.md: adds a getter only\n");
  r = check(root, "--base", "main", "--pr-body", "pr.txt");
  assert.equal(r.code, 0, r.out);

  edit(root, "docs/code/server/assets.md", "status: draft", "status: stable");
  git(root, "commit", "-qam", "doc too");
  r = check(root, "--base", "main");
  assert.equal(r.code, 0, r.out);
});
