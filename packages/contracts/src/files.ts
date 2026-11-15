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
  .regex(/^[^/\\\p{Cc}]+$/u, "a file's name, never a path")
  .refine((name) => !/^\.+$/.test(name), "a file's name, never only dots")
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
