import { z } from "zod";
import { ASSET_LIMIT_BYTES, ASSET_TYPES, assetIdSchema } from "./asset.ts";

// Files in (CAP-03, A80): a tool asks, from the person's click, for a file to open. The host page
// shows the browser's own picker, for an image, and the server keeps what the person picked as an
// asset (DATA-11), held for the tool's workspace for a while so the tool can show it and save its
// ID in its data. The tool gets the asset's ID and what it is, never a path or a folder.

/** How long a picked image is held for its workspace before its data must name it to keep it. */
export const PICK_HOLD_HOURS = 24;

/** The longest name a picked file keeps. */
export const PICK_NAME_LIMIT = 255;

/**
 * A picked file's name, as the browser gives it: never a path, so no slash, backslash or control
 * character, and never a name that is only dots.
 */
export const pickNameSchema = z
  .string()
  .min(1)
  .max(PICK_NAME_LIMIT)
  // One pattern, so the JSON Schema says it as zod does: no slash, backslash or control
  // character, and not only dots (#376 review).
  .regex(/^(?!\.+$)[^/\\\p{Cc}]+$/u, "a file's name, never a path or only dots")
  .describe("The picked file's name, as the person's computer calls it; never a path.");

/** A name the browser gave, made one a pick may carry: the last part, without what isn't allowed. */
export function pickName(raw: string): string {
  const last = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = last
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, PICK_NAME_LIMIT);
  return pickNameSchema.safeParse(cleaned).success ? cleaned : "picture";
}

export const pickedFileSchema = z
  .strictObject({
    id: assetIdSchema.describe(
      "The image's asset ID: show it with tessera.assetUrl(id), and save it in the tool's data to keep it.",
    ),
    type: z.enum(ASSET_TYPES),
    name: pickNameSchema,
    sizeBytes: z.int().min(1).max(ASSET_LIMIT_BYTES),
    widthPx: z.int().min(1),
    heightPx: z.int().min(1),
  })
  .describe("An image the person picked, kept by the host as an asset (DATA-11).");
export type PickedFile = z.infer<typeof pickedFileSchema>;

// Files out (CAP-03, A81): a tool offers a file for the person to save, from a click; the host asks
// them in plain words, and only if they say Save does the host page hand it to the browser. Only
// kinds that neither run nor render when opened: images, checked by their bytes, and plain data.

/** The image kinds a tool may offer, told by their bytes. */
export const SAVE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** The text kinds a tool may offer; JSON must parse. */
export const SAVE_TEXT_TYPES = ["text/csv", "text/plain", "application/json"] as const;
export type SaveType = (typeof SAVE_IMAGE_TYPES)[number] | (typeof SAVE_TEXT_TYPES)[number];

/** The largest file a tool may offer. */
export const SAVE_LIMIT_BYTES = 25 * 1024 * 1024;

/** The extension a saved file's name always ends with, by its kind. */
export const SAVE_EXTENSIONS: Readonly<Record<SaveType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/json": "json",
};

const saveNameSchema = z
  .string()
  .min(1)
  .max(PICK_NAME_LIMIT)
  .describe(
    "The file's name; the host keeps only its last part and makes its extension the kind's.",
  );

/** What a tool offers to save: an image's bytes, as base64, or a text. */
export const saveRequestSchema = z
  .union([
    z.strictObject({
      name: saveNameSchema,
      type: z.enum(SAVE_IMAGE_TYPES),
      bytesBase64: z
        .base64()
        .min(4)
        .max(Math.ceil(SAVE_LIMIT_BYTES / 3) * 4)
        .describe("The image's bytes, as base64, such as a canvas's toDataURL without its prefix."),
    }),
    z.strictObject({
      name: saveNameSchema,
      type: z.enum(SAVE_TEXT_TYPES),
      text: z.string().min(1).max(SAVE_LIMIT_BYTES).describe("The file's text."),
    }),
  ])
  .describe("A file a tool offers the person to save (CAP-03, A81).");
export type SaveRequest = z.infer<typeof saveRequestSchema>;

/**
 * A saved file's name: the last part of what the tool gave, without what a name may not carry,
 * and with its extension made the kind's, replacing one it had: "notes.html" saved as plain text is
 * "notes.txt", so nothing is saved under a name that would open as something else.
 */
export function saveName(raw: string, type: SaveType): string {
  const extension = SAVE_EXTENSIONS[type];
  const picked = pickName(raw);
  const base = picked === "picture" && !/picture/i.test(raw) ? "file" : picked;
  const stem = base.replace(/\.[A-Za-z][A-Za-z0-9]{0,7}$/, "").replace(/[. ]+$/, "") || "file";
  return `${stem.slice(0, PICK_NAME_LIMIT - extension.length - 1)}.${extension}`;
}

/** Whether `bytes` start as an image of `type` does: PNG's signature, JPEG's or WebP's. */
function looksLike(type: (typeof SAVE_IMAGE_TYPES)[number], bytes: Uint8Array): boolean {
  const at = (offset: number, ...expected: number[]) =>
    expected.every((value, i) => bytes[offset + i] === value);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
}

/** A file ready to save: its name, kind and bytes. */
export type SaveFile = { name: string; type: SaveType; bytes: Uint8Array<ArrayBuffer> };

const KINDS: Readonly<Record<SaveType, string>> = {
  "image/png": "a PNG image",
  "image/jpeg": "a JPEG image",
  "image/webp": "a WebP image",
  "text/csv": "a CSV table",
  "text/plain": "a text file",
  "application/json": "a JSON file",
};

/**
 * Checks what a tool offers before the person is asked (A81): an image must start as the kind it
 * says, JSON must parse, and the file must be within the limit. Gives the file to save, with its
 * name made safe, or why not, in plain words that say nothing was saved.
 */
export function checkSaveFile(
  request: SaveRequest,
): { ok: true; file: SaveFile } | { ok: false; message: string } {
  const refuse = (why: string) => ({ ok: false as const, message: `Nothing was saved: ${why}` });
  let bytes: Uint8Array<ArrayBuffer>;
  if ("bytesBase64" in request) {
    const text = atob(request.bytesBase64);
    bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
    if (!looksLike(request.type, bytes)) {
      return refuse(`the bytes aren't ${KINDS[request.type]}, as the file says.`);
    }
  } else {
    if (request.type === "application/json") {
      try {
        JSON.parse(request.text);
      } catch {
        return refuse("the text isn't JSON, as the file says.");
      }
    }
    bytes = new TextEncoder().encode(request.text);
  }
  if (bytes.byteLength > SAVE_LIMIT_BYTES) {
    return refuse(
      `the file is ${Math.ceil(bytes.byteLength / (1024 * 1024))} MB, over the limit of ${SAVE_LIMIT_BYTES / (1024 * 1024)} MB.`,
    );
  }
  return {
    ok: true,
    file: { name: saveName(request.name, request.type), type: request.type, bytes },
  };
}

/** A file's kind, in the person's words, such as "a CSV table". */
export const saveKind = (type: SaveType): string => KINDS[type];
