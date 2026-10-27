// Docs: docs/code/server/data-shape.md
// A tool's data shape: its declared schema checked with care, and declarative migrations run on a copy (DATA-03).
export {
  applyMigrations,
  LOSS_PREVIEW_LIMIT_BYTES,
  migrateData,
  type DataShape,
  type MigrationRefusal,
  type MigrationResult,
} from "./migrate.ts";
export { projectData, stepFor, type Loss } from "./project.ts";
export {
  checkToolData,
  compileToolSchema,
  TOOL_SCHEMA_KEYWORDS,
  TOOL_SCHEMA_LIMIT_BYTES,
  type SchemaCheck,
} from "./schema.ts";
