#!/usr/bin/env node
// Docs: docs/code/scripts/okf-check.md
// OKF documentation check (ENG-05, ENG-08, ENG-24, ENG-25). See docs/practices/documentation.md.
// Also checks task handoffs and history notes in context/, that CLAUDE.md only imports AGENTS.md,
// and that every skill has identical Claude Code (.claude/skills) and Codex (.agents/skills) adapters.
// Frontmatter is read with a YAML library and code with TypeScript's parser, so run `pnpm install` first.
//
// Usage: node scripts/okf-check.mjs [--fix] [--base <git-ref>] [--pr-body <file>] [--merge-ready]
//   --fix          rewrite index.md entries from frontmatter, and code docs' generated symbol sections
//   --base         also run the code-doc drift check against `git diff <base>...HEAD`
//   --pr-body      file holding the pull request description ("No doc change needed: <doc>: <reason>")
//   --merge-ready  also fail while any task handoff is left: run before merging, and on main
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  exportsOf,
  parseFrontmatter,
  renderSymbols,
  sourceFiles,
  SYMBOLS_HEADING,
} from "./okf-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "docs");
const OKF_VERSION = "0.2";
const RESERVED = new Set(["index.md", "log.md"]);
const REQUIRED = ["type", "title", "description", "status", "generated"];
const STATUSES = new Set(["draft", "stable", "deprecated"]);
const CODE_TYPES = new Set(["Code Package", "Code Module"]);
const TYPES = new Set([
  "Overview",
  "Product",
  "Glossary",
  "Principles",
  "Architecture",
  "Requirement Area",
  "Acceptance Criteria",
  "Roadmap",
  "Milestone",
  "Budget",
  "Practice",
  "Decision Log",
  "Decision",
  "Open Decision",
  "Lesson",
  "Test Design",
  "POC Reference",
  "Code Package",
  "Code Module",
  "Evaluation Report",
]);
const ACTOR = /^(human:[\w.-]+|process:[\w.-]+|[\w.-]+\/[\w.:-]+)$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const INDEX_ENTRY = /^\* \[(.+?)\]\((.+?)\)(?: - (.*))?$/;

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const FIX = args.includes("--fix");
const MERGE_READY = args.includes("--merge-ready");
const errors = [];
const warnings = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const err = (file, msg) => errors.push(`${rel(file)}: ${msg}`);
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

// ---------- bundle walk ----------
function walk(dir) {
  const files = [],
    dirs = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walk(p);
      if (sub.files.length) {
        dirs.push(p, ...sub.dirs);
        files.push(...sub.files);
      }
    } else if (e.name.endsWith(".md")) files.push(p);
  }
  return { files, dirs };
}

const { files, dirs } = walk(BUNDLE);
dirs.unshift(BUNDLE);
const concepts = new Map(); // abs path -> { fm, body }
const slug = (h) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .replace(/ /g, "-");
const stripFences = (t) => t.replace(/^```[\s\S]*?^```/gm, "");
const stripCode = (t) => stripFences(t).replace(/`[^`\n]*`/g, ""); // links inside code are not links

// Requirement IDs a code doc may implement: product requirements (spec/) and engineering rules (practices/).
const requirementIds = new Set();
const requirementDirs = ["spec", "practices"].map((d) => path.join(BUNDLE, d) + path.sep);
for (const f of files) {
  if (requirementDirs.some((d) => f.startsWith(d)))
    for (const m of read(f).matchAll(/^\| ([A-Z]+-\d+) \|/gm)) requirementIds.add(m[1]);
}

// ---------- concepts ----------
for (const f of files) {
  if (RESERVED.has(path.basename(f))) continue;
  let parsed;
  try {
    parsed = parseFrontmatter(read(f));
  } catch (e) {
    err(f, e.message);
    continue;
  }
  const { fm, body } = parsed;
  if (!fm) {
    err(f, "missing frontmatter");
    continue;
  }
  concepts.set(f, parsed);
  for (const k of REQUIRED) if (fm[k] === undefined || fm[k] === "") err(f, `missing "${k}"`);
  if (fm.type && !TYPES.has(fm.type))
    err(f, `unknown type "${fm.type}" (add it to the project types first)`);
  if (fm.status && !STATUSES.has(fm.status)) err(f, `status must be draft, stable or deprecated`);
  const checkEvent = (e, field) => {
    if (typeof e !== "object" || Array.isArray(e)) return err(f, `${field} must be { by, at }`);
    if (!ACTOR.test(e.by ?? ""))
      err(f, `${field}.by is not an actor (agent/model, human:<id>, process:<id>)`);
    if (!DATETIME.test(e.at ?? "")) err(f, `${field}.at must be an ISO datetime with an offset`);
  };
  if (fm.generated !== undefined) checkEvent(fm.generated, "generated");
  if (fm.verified !== undefined) [].concat(fm.verified).forEach((v) => checkEvent(v, "verified"));
  if (fm.stale_after !== undefined) {
    if (!DATETIME.test(fm.stale_after))
      err(f, "stale_after must be an ISO datetime with an offset");
    else if (Date.now() >= Date.parse(fm.stale_after))
      warnings.push(`${rel(f)}: stale since ${fm.stale_after}; recheck it`);
  }
  if (fm.tags !== undefined && !Array.isArray(fm.tags)) err(f, "tags must be a list");
  const ids = new Set();
  if (fm.sources !== undefined) {
    if (!Array.isArray(fm.sources)) err(f, "sources must be a list");
    else
      for (const s of fm.sources) {
        if (!s?.resource) err(f, "every sources entry needs a resource");
        if (s?.id) {
          if (ids.has(s.id)) err(f, `duplicate source id "${s.id}"`);
          ids.add(s.id);
        }
      }
  }
  for (const m of stripCode(body).matchAll(/\[\^([^\]]+)\](?!:)/g))
    if (!ids.has(m[1])) err(f, `footnote [^${m[1]}] has no matching sources id`);

  if (CODE_TYPES.has(fm.type)) {
    const dir = path.dirname(f);
    if (!fm.resource) err(f, "code docs need a resource");
    else if (!fs.existsSync(path.resolve(dir, fm.resource)))
      err(f, `resource not found: ${fm.resource}`);
    for (const t of [].concat(fm.tests ?? []))
      if (!fs.existsSync(path.resolve(dir, t))) err(f, `test not found: ${t}`);
    for (const id of [].concat(fm.implements ?? []))
      if (!requirementIds.has(id)) err(f, `implements unknown requirement ${id}`);
  }
}

// ---------- links (all .md in the bundle, including indexes and log) ----------
const anchors = new Map();
for (const f of files)
  anchors.set(
    f,
    new Set([...stripFences(read(f)).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]))),
  );
for (const f of files) {
  for (const m of stripCode(read(f)).matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = m[1];
    if (/^[a-z]+:/i.test(link)) continue;
    if (link.startsWith("/")) {
      err(f, `use a relative link, not ${link} (GitHub resolves "/" from the repository root)`);
      continue;
    }
    const [p, a] = link.split("#");
    const target = p ? path.resolve(path.dirname(f), p) : f;
    if (!fs.existsSync(target)) {
      err(f, `broken link: ${link}`);
      continue;
    }
    if (a && fs.statSync(target).isFile() && !anchors.get(target)?.has(a))
      err(f, `broken anchor: ${link}`);
  }
}

// ---------- indexes ----------
for (const dir of dirs) {
  const idx = path.join(dir, "index.md");
  if (!fs.existsSync(idx)) {
    err(dir, "folder has no index.md");
    continue;
  }
  let text = read(idx);
  let fmText = "";
  if (text.startsWith("---\n")) {
    const { fm, body } = parseFrontmatter(text);
    fmText = text.slice(0, text.length - body.length);
    if (dir !== BUNDLE || Object.keys(fm).some((k) => k !== "okf_version"))
      err(idx, "only the root index.md may have frontmatter, and only okf_version");
    if (dir === BUNDLE && fm.okf_version !== OKF_VERSION)
      err(idx, `okf_version must be "${OKF_VERSION}"`);
    text = body;
  } else if (dir === BUNDLE) err(idx, `root index.md must declare okf_version: "${OKF_VERSION}"`);

  const listed = new Map();
  let changed = false;
  const lines = text.split("\n").map((line) => {
    const m = INDEX_ENTRY.exec(line);
    if (!m) return line;
    const target = path.resolve(dir, m[2].replace(/\/$/, "/index.md"));
    listed.set(target, (listed.get(target) ?? 0) + 1);
    const c = concepts.get(target);
    if (!c || path.dirname(target) !== dir || !c.fm.title || !c.fm.description) return line;
    const want = `* [${c.fm.title}](${m[2]}) - ${c.fm.description}`;
    if (line === want) return line;
    if (FIX) {
      changed = true;
      return want;
    }
    err(
      idx,
      `entry for ${m[2]} differs from its frontmatter title or description (run with --fix)`,
    );
    return line;
  });
  const expected = [
    ...[...concepts.keys()].filter((c) => path.dirname(c) === dir),
    ...dirs.filter((d) => path.dirname(d) === dir).map((d) => path.join(d, "index.md")),
  ];
  for (const e of expected) {
    const n = listed.get(e) ?? 0;
    if (n > 1) err(idx, `${rel(e)} is listed ${n} times`);
    if (n) continue;
    const c = concepts.get(e);
    if (FIX && c?.fm.title && c.fm.description) {
      while (lines.at(-1) === "") lines.pop();
      lines.push(`* [${c.fm.title}](${path.basename(e)}) - ${c.fm.description}`, "");
      changed = true;
    } else err(idx, `missing entry for ${rel(e)}${c ? " (run with --fix)" : ""}`);
  }
  if (changed) fs.writeFileSync(idx, fmText + lines.join("\n"));
}

// ---------- log ----------
const logFile = path.join(BUNDLE, "log.md");
if (fs.existsSync(logFile)) {
  let prev = null;
  for (const m of read(logFile).matchAll(/^## (.+)$/gm)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m[1]) || isNaN(Date.parse(m[1]))) {
      err(logFile, `date heading must be YYYY-MM-DD: ${m[1]}`);
      continue;
    }
    if (prev && m[1] > prev) err(logFile, `entries must be newest first (${m[1]} after ${prev})`);
    prev = m[1];
  }
} else err(BUNDLE, "missing log.md");

// ---------- code docs: back-links, named symbols, generated symbol sections and drift ----------
const codeDocs = [...concepts].filter(([, c]) => CODE_TYPES.has(c.fm.type));
const backLinked = new Set();
// Tests are skipped: a module's main file names its doc, and a test may hold sample Docs: text.
for (const codeRoot of ["packages", "evals", "scripts"].map((d) => path.join(ROOT, d))) {
  if (!fs.existsSync(codeRoot)) continue;
  const stack = [codeRoot];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!["node_modules", "dist", "test", "e2e"].includes(e.name)) stack.push(p);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|css)$/.test(e.name) || /\.(test|spec)\.\w+$/.test(e.name)) continue;
      for (const m of read(p).matchAll(/Docs: (docs\/[\w./-]+\.md)/g)) {
        const doc = path.join(ROOT, m[1]);
        if (!fs.existsSync(doc)) err(p, `Docs comment points to a missing doc: ${m[1]}`);
        else backLinked.add(doc);
      }
    }
  }
}
for (const [f] of codeDocs)
  if (!backLinked.has(f)) err(f, "no code file names this doc in a `Docs:` comment");

// Symbols named in backticks under "# Entry points" must be exported by the code the doc describes,
// and the "# Symbols (generated)" section must match that code (`--fix` rewrites it).
const sectionOf = (body, heading) => {
  const m = new RegExp(`^# ${heading}\\s*$([\\s\\S]*?)(?=^# |(?![\\s\\S]))`, "m").exec(body);
  return m ? m[1] : "";
};
for (const [f, c] of codeDocs) {
  if (!c.fm.resource) continue;
  const resource = path.resolve(path.dirname(f), c.fm.resource);
  if (!fs.existsSync(resource)) continue;
  const exported = new Set(
    sourceFiles(resource).flatMap((file) => exportsOf(file).map((s) => s.name)),
  );
  for (const m of stripFences(sectionOf(c.body, "Entry points")).matchAll(/`([A-Za-z_$][\w$]*)`/g))
    if (!exported.has(m[1]))
      err(f, `names \`${m[1]}\` under Entry points, which ${rel(resource)} doesn't export`);

  const expected = renderSymbols(resource);
  const at = c.body.indexOf(`\n${SYMBOLS_HEADING}\n`);
  const current = at < 0 ? null : c.body.slice(at + 1).trimEnd() + "\n";
  if (current === expected) continue;
  if (FIX) {
    const kept = (at < 0 ? c.body : c.body.slice(0, at + 1)).trimEnd();
    const text = read(f);
    const head = text.slice(0, text.length - c.body.length);
    fs.writeFileSync(f, `${head}${kept}${expected ? `\n\n${expected}` : "\n"}`);
  } else if (expected === null)
    err(f, `has a symbol section, but ${rel(resource)} exports nothing; run --fix`);
  else
    err(
      f,
      `the "${SYMBOLS_HEADING}" section is ${at < 0 ? "missing" : "out of date"}; run node scripts/okf-check.mjs --fix`,
    );
}

const base = opt("--base");
if (base) {
  const changedFiles = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  let prBody = "";
  if (opt("--pr-body")) prBody = read(path.resolve(opt("--pr-body")));
  else if (process.env.GITHUB_EVENT_PATH)
    prBody = JSON.parse(read(process.env.GITHUB_EVENT_PATH)).pull_request?.body ?? "";
  const excused = new Set(
    [...prBody.matchAll(/^No doc change needed: (docs\/\S+\.md): \S.*$/gim)].map((m) => m[1]),
  );
  for (const [f, c] of codeDocs) {
    if (!c.fm.resource) continue;
    const res = rel(path.resolve(path.dirname(f), c.fm.resource)).replace(/\/$/, "");
    const touched = changedFiles.filter((x) => x === res || x.startsWith(res + "/"));
    if (touched.length && !changedFiles.includes(rel(f)) && !excused.has(rel(f)))
      err(
        f,
        `code under ${res} changed (${touched.join(", ")}) but this doc did not; update it or add "No doc change needed: ${rel(f)}: <reason>" to the pull request description`,
      );
  }
}

// ---------- task context: handoffs and history notes (ENG-25, ENG-26) ----------
const CONTEXT = path.join(ROOT, "context");
const TASK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBJECT = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HANDOFF_STATUSES = new Set(["in-progress", "blocked", "ready-for-review"]);
const HANDOFF_MAX_AGE_DAYS = 5;
const isDay = (d) => DAY.test(d ?? "") && !isNaN(Date.parse(d));
const subjectExists = (s) =>
  SUBJECT.test(s ?? "") &&
  (fs.existsSync(path.join(BUNDLE, `${s}.md`)) || fs.existsSync(path.join(BUNDLE, s, "index.md")));
const anchorCache = new Map();
const anchorsOf = (f) => {
  if (!anchorCache.has(f))
    anchorCache.set(
      f,
      new Set([...stripFences(read(f)).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]))),
    );
  return anchorCache.get(f);
};
const walkAll = (d) =>
  fs.existsSync(d)
    ? fs
        .readdirSync(d, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walkAll(path.join(d, e.name)) : [path.join(d, e.name)]))
    : [];

// Markdown links resolve from the file; `backticked` paths resolve from the repository root.
function checkReferences(f, body) {
  const text = stripFences(body);
  for (const m of text.replace(/`[^`\n]*`/g, "").matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    const [p, a] = m[1].split("#");
    const target = p ? path.resolve(path.dirname(f), p) : f;
    if (!fs.existsSync(target)) err(f, `broken link: ${m[1]}`);
    else if (a && target.endsWith(".md") && !anchorsOf(target).has(a))
      err(f, `broken anchor: ${m[1]}`);
  }
  for (const m of text.matchAll(
    /`((?:docs|context|scripts|packages|evals)\/[^`\s#]*)(?:#([^`\s]+))?`/g,
  )) {
    const target = path.join(ROOT, m[1]);
    if (!fs.existsSync(target)) err(f, `reference not found: ${m[1]}`);
    else if (m[2] && target.endsWith(".md") && !anchorsOf(target).has(m[2]))
      err(f, `reference anchor not found: ${m[1]}#${m[2]}`);
  }
}

function contextFile(f) {
  try {
    const parsed = parseFrontmatter(read(f));
    if (!parsed.fm) err(f, "missing frontmatter");
    return parsed.fm ? parsed : null;
  } catch (e) {
    err(f, e.message);
    return null;
  }
}

if (fs.existsSync(CONTEXT)) {
  for (const e of fs.readdirSync(CONTEXT, { withFileTypes: true }))
    if (e.isDirectory() ? !["handoffs", "history"].includes(e.name) : e.name !== "README.md")
      err(path.join(CONTEXT, e.name), "context/ holds only README.md, handoffs/ and history/");
  if (fs.existsSync(path.join(CONTEXT, "README.md")))
    checkReferences(path.join(CONTEXT, "README.md"), read(path.join(CONTEXT, "README.md")));

  const handoffDir = path.join(CONTEXT, "handoffs");
  for (const f of walkAll(handoffDir)) {
    if (path.basename(f) === ".gitkeep") continue;
    if (path.dirname(f) !== handoffDir || !f.endsWith(".md")) {
      err(f, "handoffs are .md files directly in context/handoffs/");
      continue;
    }
    if (MERGE_READY)
      err(
        f,
        "not ready to merge: the last commit of the task's pull request removes its handoff (ENG-25)",
      );
    const c = contextFile(f);
    if (!c) continue;
    const { fm, body } = c;
    const id = path.basename(f, ".md");
    if (!TASK_ID.test(id)) err(f, "task IDs are lowercase words joined by hyphens");
    if (fm.task_id !== id) err(f, `task_id must match the file name (${id})`);
    if (fm.status === "complete")
      err(f, "remove a finished task's handoff instead of marking it complete");
    else if (!HANDOFF_STATUSES.has(fm.status))
      err(f, "status must be in-progress, blocked or ready-for-review");
    if (!isDay(fm.checkpoint_date)) err(f, "checkpoint_date must be YYYY-MM-DD");
    else {
      const age = Math.floor((Date.now() - Date.parse(fm.checkpoint_date)) / 86_400_000);
      if (age > HANDOFF_MAX_AGE_DAYS)
        warnings.push(
          `${rel(f)}: checkpointed ${age} days ago; refresh it with a checkpoint, or end the task (ENG-25)`,
        );
    }
    if (!subjectExists(fm.subject)) err(f, `subject is not a docs path: ${fm.subject}`);
    if (fm.parent !== undefined && !TASK_ID.test(fm.parent)) err(f, "parent must be a task ID");
    const words = (body.match(/\S+/g) ?? []).length;
    if (words > 700)
      err(
        f,
        `handoff has ${words} words; the limit is 700, so link to docs instead of copying them`,
      );
    else if (words > 500) warnings.push(`${rel(f)}: handoff has ${words} words; aim for 250–500`);
    checkReferences(f, body);
  }

  const historyDir = path.join(CONTEXT, "history");
  for (const f of walkAll(historyDir)) {
    if (path.basename(f) === ".gitkeep") continue;
    if (!f.endsWith(".md")) {
      err(f, "history notes are .md files");
      continue;
    }
    const c = contextFile(f);
    if (!c) continue;
    const { fm, body } = c;
    const folder = path.relative(historyDir, path.dirname(f)).split(path.sep).join("/");
    if (fm.subject !== folder) err(f, `subject must match its folder (${folder || "none"})`);
    if (!subjectExists(fm.subject)) err(f, `subject is not a docs path: ${fm.subject}`);
    if (!TASK_ID.test(fm.task_id ?? ""))
      err(f, "task_id must be lowercase words joined by hyphens");
    if (!isDay(fm.date)) err(f, "date must be YYYY-MM-DD");
    if (path.basename(f) !== `${fm.date}-${fm.task_id}.md`)
      err(f, "file name must be <date>-<task_id>.md");
    if (fm.status !== "historical") err(f, "status must be historical");
    checkReferences(f, body);
  }
}

// ---------- rules files: CLAUDE.md only imports AGENTS.md, so both assistants read the same rules (ENG-05) ----------
const AGENTS_MD = path.join(ROOT, "AGENTS.md");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
if (!fs.existsSync(AGENTS_MD))
  err(AGENTS_MD, "missing: AGENTS.md is the rules file for every assistant (ENG-05)");
if (!fs.existsSync(CLAUDE_MD))
  err(CLAUDE_MD, "missing: CLAUDE.md must contain only @AGENTS.md (ENG-05)");
else if (read(CLAUDE_MD).trim() !== "@AGENTS.md")
  err(
    CLAUDE_MD,
    "must contain only @AGENTS.md; rules go in AGENTS.md, where Codex reads them too (ENG-05)",
  );

// ---------- skills: one procedure in docs/, identical thin adapters for each tool ----------
const SKILL_ROOTS = {
  "Claude Code": path.join(ROOT, ".claude", "skills"),
  Codex: path.join(ROOT, ".agents", "skills"),
};
const skillNames = new Set(
  Object.values(SKILL_ROOTS).flatMap((r) =>
    fs.existsSync(r)
      ? fs
          .readdirSync(r, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [],
  ),
);
for (const name of skillNames) {
  const adapters = {};
  for (const [tool, root] of Object.entries(SKILL_ROOTS)) {
    const f = path.join(root, name, "SKILL.md");
    if (!fs.existsSync(f)) {
      err(f, `missing: every skill needs both a Claude Code and a Codex adapter`);
      continue;
    }
    const c = contextFile(f);
    if (!c) continue;
    if (c.fm.name !== name) err(f, `name must be "${name}", the folder name`);
    if (!c.fm.description) err(f, "missing description");
    checkReferences(f, c.body);
    adapters[tool] = { f, ...c };
  }
  const claude = adapters["Claude Code"],
    codex = adapters.Codex;
  if (!claude || !codex) continue;
  if (claude.fm.description !== codex.fm.description)
    err(codex.f, "description differs from the Claude Code adapter");
  if (claude.body !== codex.body)
    err(codex.f, "instructions differ from the Claude Code adapter; keep the two identical");
  const policy = path.join(SKILL_ROOTS.Codex, name, "agents", "openai.yaml");
  const codexManual =
    fs.existsSync(policy) && /^\s*allow_implicit_invocation:\s*false\s*$/m.test(read(policy));
  if ((String(claude.fm["disable-model-invocation"]) === "true") !== codexManual)
    err(
      codex.f,
      "Claude Code (disable-model-invocation) and Codex (agents/openai.yaml allow_implicit_invocation) must agree on whether the skill runs only when asked",
    );
}

// ---------- report ----------
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
console.log(
  `\nOKF check: ${concepts.size} concepts, ${dirs.length} folders, ${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length ? 1 : 0);
