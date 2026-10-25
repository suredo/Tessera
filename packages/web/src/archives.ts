import {
  EXPORT_ROUTE,
  IMPORT_ROUTE,
  importReplySchema,
  type ExportRequest,
  type ImportReply,
} from "@tessera/contracts";
import { HostError, type Send } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

// The host app's side of export and import (APP-06): an export comes back as a file the browser
// saves, and an import sends a file's bytes and reads the plain report of what came in (DATA-05).

/** The file name the server gave, from its Content-Disposition header. */
function fileName(disposition: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain name.
    }
  }
  return /filename="([^"]+)"/i.exec(disposition ?? "")?.[1] ?? "export.tessera";
}

/** Asks the server for an archive; resolves with its file name and bytes, or rejects plainly. */
export async function exportArchive(
  request: ExportRequest,
  send: Send = (url, init) => fetch(url, init),
): Promise<{ name: string; file: Blob }> {
  const response = await send(EXPORT_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  // A refusal is the server's plain sentence; anything unexpected is said in the host's words.
  if (!response.ok) {
    const said = await response.text().catch(() => "");
    throw new HostError(said && response.status < 500 ? said : t("archive.exportFailed"));
  }
  return {
    name: fileName(response.headers.get("content-disposition")),
    file: await response.blob(),
  };
}

/** Sends a file to import; resolves with what came in, or why nothing did. */
export async function importArchive(
  file: Blob,
  send: Send = (url, init) => fetch(url, init),
): Promise<ImportReply> {
  const response = await send(IMPORT_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: file,
  });
  const reply = importReplySchema.safeParse(await response.json().catch(() => undefined));
  if (!reply.success) throw new HostError(t("app.unreadable"));
  return reply.data;
}

/** Has the browser save `file` as `name`, as a download. */
export function saveFile(name: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to start the download, then the bytes can go.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
