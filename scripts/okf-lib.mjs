// Docs: docs/code/scripts/okf-check.md
// Shared by the OKF check (scripts/okf-check.mjs) and its tests: frontmatter parsing with a YAML
// library (ENG-08), and the exported symbols of the code a code doc describes (ENG-24).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import YAML from "yaml";

/** Splits a Markdown file into its YAML frontmatter (or null) and its body. */
export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { fm: null, body: text };
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) throw new Error("frontmatter is not closed with ---");
  let fm;
  try {
    // YAML 1.2's core schema: dates stay text, and a repeated key is an error.
    fm = YAML.parse(text.slice(4, end), { schema: "core", uniqueKeys: true });
  } catch (e) {
    throw new Error(
      `frontmatter is not valid YAML (quote values that contain ": "): ${e.message.split("\n")[0]}`,
      { cause: e },
    );
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) {
    throw new Error("frontmatter must be a set of key: value lines");
  }
  return { fm, body: text.slice(end + 5) };
}

// ---------- exported symbols ----------

// Tests (unit and browser), declarations and build output aren't the code a doc describes.
const SKIP_DIRS = new Set(["node_modules", "dist", "test", "tests", "e2e"]);
const isSource = (name) => /\.tsx?$/.test(name) && !/\.(test|spec|d)\.tsx?$/.test(name);

/** The TypeScript source files under a resource (a folder or a file), tests left out, sorted. */
export function sourceFiles(resource) {
  if (!fs.existsSync(resource)) return [];
  if (fs.statSync(resource).isFile()) return isSource(resource) ? [resource] : [];
  const found = [];
  for (const entry of fs.readdirSync(resource, { withFileTypes: true })) {
    const p = path.join(resource, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...sourceFiles(p));
    } else if (isSource(entry.name)) found.push(p);
  }
  return found.sort();
}

const hasModifier = (node, kind) => (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

// The names a declaration binds, including destructuring: `const { a, b: c, ...d } = x` binds a, c, d.
const boundNames = (name) =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)));

/** What a file exports, in source order, read from its syntax tree: `{ name, type }`. */
export function exportsOf(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const found = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      // `export { a, type B } from "./x.ts"` and `export * as ns from`; a bare `export * from`
      // names nothing here.
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          found.push({ name: el.name.text, type: statement.isTypeOnly || el.isTypeOnly });
        }
      } else if (clause && ts.isNamespaceExport(clause)) {
        found.push({ name: clause.name.text, type: statement.isTypeOnly });
      }
    } else if (ts.isExportAssignment(statement)) {
      found.push({ name: "default", type: false });
    } else if (
      ts.canHaveModifiers(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      const type = ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
        found.push({ name: "default", type });
      else if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          for (const name of boundNames(d.name)) found.push({ name, type: false });
        }
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        found.push({ name: statement.name.text, type });
      }
    }
  }
  return found;
}

export const SYMBOLS_HEADING = "# Symbols (generated)";

/** The generated symbol section for a resource, or null when its code exports nothing. */
export function renderSymbols(resource) {
  const base =
    fs.existsSync(resource) && fs.statSync(resource).isFile() ? path.dirname(resource) : resource;
  const lines = [];
  for (const file of sourceFiles(resource)) {
    const names = exportsOf(file).map((s) => `\`${s.name}\`${s.type ? " (type)" : ""}`);
    if (names.length)
      lines.push(
        `- \`${path.relative(base, file).split(path.sep).join("/")}\`: ${names.join(", ")}`,
      );
  }
  if (!lines.length) return null;
  return [
    SYMBOLS_HEADING,
    "",
    "Written by `node scripts/okf-check.mjs --fix`; don't edit it by hand.",
    "",
    ...lines,
    "",
  ].join("\n");
}
