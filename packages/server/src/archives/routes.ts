import {
  EXPORT_ROUTE,
  exportRequestSchema,
  IMPORT_ROUTE,
  type ImportReply,
} from "@tessera/contracts";
import { json, readBytes, readJson, text } from "../http/body.ts";
import type { Handler } from "../http/server.ts";
import type { DataFolder } from "../storage/index.ts";
import { getSavedTool, getWorkspace } from "../workspaces/index.ts";
import {
  ARCHIVE_EXTENSION,
  ARCHIVE_LIMITS,
  exportName,
  exportSavedTool,
  exportWorkspace,
  importArchive,
} from "./archive.ts";
import { ArchiveError } from "./zip.ts";

// The host app's archive routes (APP-06, DATA-05): export answers with the archive as a file to
// save, and import reads a file's bytes and answers what came in. The local server's guard has
// already checked the request comes from the host app (SEC-03). A refusal is the archive module's
// own plain sentence; any other failure says only that nothing was changed.

const EXPORT_REQUEST_LIMIT_BYTES = 4 * 1024;
const MEGABYTE = 1024 * 1024;

/** A file name for the Content-Disposition header: ASCII for old clients, UTF-8 for the rest. */
const disposition = (file: string) =>
  `attachment; filename="${file.replace(/[^\x20-\x7e]|["\\]/g, "-")}"; ` +
  `filename*=UTF-8''${encodeURIComponent(file)}`;

export function archiveRoutes(folder: DataFolder): Record<string, Handler> {
  return {
    [EXPORT_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
      const body = await readJson(req, EXPORT_REQUEST_LIMIT_BYTES);
      if (body === "too-large") return text(res, 413, "The request is too large.");
      const request = body === "invalid" ? undefined : exportRequestSchema.safeParse(body.json);
      if (!request?.success) return text(res, 400, "Say which workspace or saved tool to export.");
      const { exported, id } = request.data;
      try {
        const bytes =
          exported === "workspace" ? exportWorkspace(folder, id) : exportSavedTool(folder, id);
        const name =
          (exported === "workspace"
            ? getWorkspace(folder, id)?.title
            : getSavedTool(folder, id)?.name) ?? "export";
        res
          .writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": bytes.byteLength,
            "content-disposition": disposition(exportName(name, folder.now()) + ARCHIVE_EXTENSION),
          })
          .end(bytes);
      } catch (error) {
        if (error instanceof ArchiveError) return text(res, 404, error.message);
        text(res, 500, "Tessera couldn't make the file. Nothing was changed.");
      }
    },

    [IMPORT_ROUTE]: async (req, res) => {
      if (req.method !== "POST") return text(res, 405, "Send a request with POST.");
      const reply = (answer: ImportReply) => json(res, answer);
      const tooLarge = () =>
        reply({
          ok: false,
          message: `The file is larger than Tessera imports (${Math.floor(
            ARCHIVE_LIMITS.archiveBytes / MEGABYTE,
          )} MB). Nothing was imported.`,
        });
      if (Number(req.headers["content-length"] ?? 0) > ARCHIVE_LIMITS.archiveBytes) {
        return tooLarge();
      }
      const bytes = await readBytes(req, ARCHIVE_LIMITS.archiveBytes);
      if (bytes === "too-large") return tooLarge();
      try {
        const imported = await importArchive(folder, bytes);
        reply({
          ok: true,
          exported: imported.exported,
          workspaces: imported.workspaces.map(({ id, title }) => ({ id, title })),
          savedTools: imported.savedTools.map(({ id, name }) => ({ id, name })),
          asCopy: imported.asCopy,
        });
      } catch (error) {
        reply({
          ok: false,
          message:
            error instanceof ArchiveError
              ? error.message
              : "Tessera couldn't import that file. Nothing was imported.",
        });
      }
    },
  };
}
