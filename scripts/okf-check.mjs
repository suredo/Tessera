#!/usr/bin/env node
// OKF documentation check (ENG-08, ENG-24). See docs/practices/documentation.md.
// Zero dependencies until the M0 tooling exists, so frontmatter uses a simple YAML subset.
//
// Usage: node scripts/okf-check.mjs [--fix] [--base <git-ref>] [--pr-body <file>]
//   --fix       rewrite index.md entries (title, description) from frontmatter and add missing ones
//   --base      also run the code-doc drift check against `git diff <base>...HEAD`
//   --pr-body   file holding the pull request description ("No doc change needed: <doc>: <reason>")
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "docs");
const OKF_VERSION = "0.2";
const RESERVED = new Set(["index.md", "log.md"]);
const REQUIRED = ["type", "title", "description", "status", "generated"];
const STATUSES = new Set(["draft", "stable", "deprecated"]);
const CODE_TYPES = new Set(["Code Package", "Code Module"]);
const TYPES = new Set([
  "Overview", "Product", "Glossary", "Principles", "Architecture", "Requirement Area", "Acceptance Criteria",
  "Roadmap", "Milestone", "Budget", "Practice", "Decision Log", "Decision", "Open Decision", "Lesson",
  "Test Design", "POC Reference", "Code Package", "Code Module", "Evaluation Report",
]);
const ACTOR = /^(human:[\w.-]+|process:[\w.-]+|[\w.-]+\/[\w.:-]+)$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const INDEX_ENTRY = /^\* \[(.+?)\]\((.+?)\)(?: - (.*))?$/;

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const FIX = args.includes("--fix");
const errors = [];
const warnings = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const err = (file, msg) => errors.push(`${rel(file)}: ${msg}`);
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

// ---------- frontmatter: a simple YAML subset ----------
function splitTop(s) {
  const parts = [];
  let depth = 0, quote = null, cur = "";
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseValue(v) {
  v = v.trim();
  if (v.startsWith("[")) {
    if (!v.endsWith("]")) throw new Error(`unclosed list: ${v}`);
    return splitTop(v.slice(1, -1)).map(parseValue);
  }
  if (v.startsWith("{")) {
    if (!v.endsWith("}")) throw new Error(`unclosed map: ${v}`);
    const o = {};
    for (const part of splitTop(v.slice(1, -1))) {
      const k = part.indexOf(": ");
      if (k < 0) throw new Error(`map entry without "key: value": ${part}`);
      o[part.slice(0, k).trim()] = parseValue(part.slice(k + 2));
    }
    return o;
  }
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) throw new Error(`unclosed quote: ${v}`);
    return JSON.parse(v);
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) throw new Error(`unclosed quote: ${v}`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  // Plain scalars must also be plain in real YAML, so other OKF consumers read them the same way.
  if (/: |\s#/.test(v) || /^[&*!|>%@`?-]/.test(v)) throw new Error(`quote this value: ${v}`);
  return v;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { fm: null, body: text };
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) throw new Error("frontmatter is not closed with ---");
  const lines = text.slice(4, end).split("\n");
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!m) throw new Error(`unsupported frontmatter line: ${line}`);
    const [, key, rest] = m;
    if (key in fm) throw new Error(`duplicate key: ${key}`);
    if (rest) { fm[key] = parseValue(rest); continue; }
    const items = [];
    while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) items.push(parseValue(lines[++i].replace(/^\s+-\s+/, "")));
    if (!items.length) throw new Error(`key "${key}" has no value`);
    fm[key] = items;
  }
  return { fm, body: text.slice(end + 5) };
}

// ---------- bundle walk ----------
function walk(dir) {
  const files = [], dirs = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walk(p);
      if (sub.files.length) { dirs.push(p, ...sub.dirs); files.push(...sub.files); }
    } else if (e.name.endsWith(".md")) files.push(p);
  }
  return { files, dirs };
}

const { files, dirs } = walk(BUNDLE);
dirs.unshift(BUNDLE);
const concepts = new Map(); // abs path -> { fm, body }
const slug = (h) => h.trim().toLowerCase().replace(/[`*]/g, "").replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/ /g, "-");
const stripFences = (t) => t.replace(/^```[\s\S]*?^```/gm, "");
const stripCode = (t) => stripFences(t).replace(/`[^`\n]*`/g, ""); // links inside code are not links

const specIds = new Set();
for (const f of files) {
  if (f.startsWith(path.join(BUNDLE, "spec") + path.sep))
    for (const m of read(f).matchAll(/^\| ([A-Z]+-\d+) \|/gm)) specIds.add(m[1]);
}

// ---------- concepts ----------
for (const f of files) {
  if (RESERVED.has(path.basename(f))) continue;
  let parsed;
  try { parsed = parseFrontmatter(read(f)); } catch (e) { err(f, e.message); continue; }
  const { fm, body } = parsed;
  if (!fm) { err(f, "missing frontmatter"); continue; }
  concepts.set(f, parsed);
  for (const k of REQUIRED) if (fm[k] === undefined || fm[k] === "") err(f, `missing "${k}"`);
  if (fm.type && !TYPES.has(fm.type)) err(f, `unknown type "${fm.type}" (add it to the project types first)`);
  if (fm.status && !STATUSES.has(fm.status)) err(f, `status must be draft, stable or deprecated`);
  const checkEvent = (e, field) => {
    if (typeof e !== "object" || Array.isArray(e)) return err(f, `${field} must be { by, at }`);
    if (!ACTOR.test(e.by ?? "")) err(f, `${field}.by is not an actor (agent/model, human:<id>, process:<id>)`);
    if (!DATETIME.test(e.at ?? "")) err(f, `${field}.at must be an ISO datetime with an offset`);
  };
  if (fm.generated !== undefined) checkEvent(fm.generated, "generated");
  if (fm.verified !== undefined) [].concat(fm.verified).forEach((v) => checkEvent(v, "verified"));
  if (fm.stale_after !== undefined) {
    if (!DATETIME.test(fm.stale_after)) err(f, "stale_after must be an ISO datetime with an offset");
    else if (Date.now() >= Date.parse(fm.stale_after)) warnings.push(`${rel(f)}: stale since ${fm.stale_after}; recheck it`);
  }
  if (fm.tags !== undefined && !Array.isArray(fm.tags)) err(f, "tags must be a list");
  const ids = new Set();
  if (fm.sources !== undefined) {
    if (!Array.isArray(fm.sources)) err(f, "sources must be a list");
    else for (const s of fm.sources) {
      if (!s?.resource) err(f, "every sources entry needs a resource");
      if (s?.id) { if (ids.has(s.id)) err(f, `duplicate source id "${s.id}"`); ids.add(s.id); }
    }
  }
  for (const m of stripCode(body).matchAll(/\[\^([^\]]+)\](?!:)/g))
    if (!ids.has(m[1])) err(f, `footnote [^${m[1]}] has no matching sources id`);

  if (CODE_TYPES.has(fm.type)) {
    const dir = path.dirname(f);
    if (!fm.resource) err(f, "code docs need a resource");
    else if (!fs.existsSync(path.resolve(dir, fm.resource))) err(f, `resource not found: ${fm.resource}`);
    for (const t of [].concat(fm.tests ?? [])) if (!fs.existsSync(path.resolve(dir, t))) err(f, `test not found: ${t}`);
    for (const id of [].concat(fm.implements ?? [])) if (!specIds.has(id)) err(f, `implements unknown requirement ${id}`);
  }
}

// ---------- links (all .md in the bundle, including indexes and log) ----------
const anchors = new Map();
for (const f of files) anchors.set(f, new Set([...stripFences(read(f)).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]))));
for (const f of files) {
  for (const m of stripCode(read(f)).matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = m[1];
    if (/^[a-z]+:/i.test(link)) continue;
    if (link.startsWith("/")) { err(f, `use a relative link, not ${link} (GitHub resolves "/" from the repository root)`); continue; }
    const [p, a] = link.split("#");
    const target = p ? path.resolve(path.dirname(f), p) : f;
    if (!fs.existsSync(target)) { err(f, `broken link: ${link}`); continue; }
    if (a && fs.statSync(target).isFile() && !anchors.get(target)?.has(a)) err(f, `broken anchor: ${link}`);
  }
}

// ---------- indexes ----------
for (const dir of dirs) {
  const idx = path.join(dir, "index.md");
  if (!fs.existsSync(idx)) { err(dir, "folder has no index.md"); continue; }
  let text = read(idx);
  let fmText = "";
  if (text.startsWith("---\n")) {
    const { fm, body } = parseFrontmatter(text);
    fmText = text.slice(0, text.length - body.length);
    if (dir !== BUNDLE || Object.keys(fm).some((k) => k !== "okf_version")) err(idx, "only the root index.md may have frontmatter, and only okf_version");
    if (dir === BUNDLE && fm.okf_version !== OKF_VERSION) err(idx, `okf_version must be "${OKF_VERSION}"`);
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
    if (FIX) { changed = true; return want; }
    err(idx, `entry for ${m[2]} differs from its frontmatter title or description (run with --fix)`);
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
    if (FIX && c?.fm.title && c.fm.description) { while (lines.at(-1) === "") lines.pop(); lines.push(`* [${c.fm.title}](${path.basename(e)}) - ${c.fm.description}`, ""); changed = true; }
    else err(idx, `missing entry for ${rel(e)}${c ? " (run with --fix)" : ""}`);
  }
  if (changed) fs.writeFileSync(idx, fmText + lines.join("\n"));
}

// ---------- log ----------
const logFile = path.join(BUNDLE, "log.md");
if (fs.existsSync(logFile)) {
  let prev = null;
  for (const m of read(logFile).matchAll(/^## (.+)$/gm)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m[1]) || isNaN(Date.parse(m[1]))) { err(logFile, `date heading must be YYYY-MM-DD: ${m[1]}`); continue; }
    if (prev && m[1] > prev) err(logFile, `entries must be newest first (${m[1]} after ${prev})`);
    prev = m[1];
  }
} else err(BUNDLE, "missing log.md");

// ---------- code docs: back-links and drift ----------
const codeDocs = [...concepts].filter(([, c]) => CODE_TYPES.has(c.fm.type));
const packages = path.join(ROOT, "packages");
const backLinked = new Set();
if (fs.existsSync(packages)) {
  const stack = [packages];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") stack.push(p); continue; }
      if (!/\.(ts|tsx|js|mjs|css)$/.test(e.name)) continue;
      for (const m of read(p).matchAll(/Docs: (docs\/[\w./-]+\.md)/g)) {
        const doc = path.join(ROOT, m[1]);
        if (!fs.existsSync(doc)) err(p, `Docs comment points to a missing doc: ${m[1]}`);
        else backLinked.add(doc);
      }
    }
  }
}
for (const [f] of codeDocs) if (!backLinked.has(f)) err(f, "no code file names this doc in a `Docs:` comment");

const base = opt("--base");
if (base) {
  const changedFiles = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  let prBody = "";
  if (opt("--pr-body")) prBody = read(path.resolve(opt("--pr-body")));
  else if (process.env.GITHUB_EVENT_PATH) prBody = JSON.parse(read(process.env.GITHUB_EVENT_PATH)).pull_request?.body ?? "";
  const excused = new Set([...prBody.matchAll(/^No doc change needed: (docs\/\S+\.md): \S.*$/gim)].map((m) => m[1]));
  for (const [f, c] of codeDocs) {
    if (!c.fm.resource) continue;
    const res = rel(path.resolve(path.dirname(f), c.fm.resource)).replace(/\/$/, "");
    const touched = changedFiles.filter((x) => x === res || x.startsWith(res + "/"));
    if (touched.length && !changedFiles.includes(rel(f)) && !excused.has(rel(f)))
      err(f, `code under ${res} changed (${touched.join(", ")}) but this doc did not; update it or add "No doc change needed: ${rel(f)}: <reason>" to the pull request description`);
  }
}

// ---------- report ----------
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
console.log(`\nOKF check: ${concepts.size} concepts, ${dirs.length} folders, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
