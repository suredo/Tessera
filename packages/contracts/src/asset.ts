import { z } from "zod";

// Binary assets (DATA-11): photos and other images, stored once by their SHA-256 in the data
// folder and named by it in tool data. A tool never sees a file path, only bytes and a type.

/** The image types an asset may be, told by its content, never by its name. SVG is not one. */
export const ASSET_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** The largest one asset may be (DATA-11). */
export const ASSET_LIMIT_BYTES = 25 * 1024 * 1024;
/** The most the assets one workspace refers to may add up to (DATA-11). */
export const WORKSPACE_ASSETS_LIMIT_BYTES = 500 * 1024 * 1024;

/** An asset's ID: the SHA-256 of its bytes, as 64 lowercase hex digits. */
export const assetIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe("An asset's ID: the SHA-256 of its bytes (DATA-11).");

export const assetSchema = z
  .strictObject({
    id: assetIdSchema,
    type: z.enum(ASSET_TYPES),
    sizeBytes: z.int().min(1).max(ASSET_LIMIT_BYTES),
    widthPx: z.int().min(1),
    heightPx: z.int().min(1),
    originalName: z.string().max(255).nullable().describe("The name it came with, if any."),
    createdAt: z.iso.datetime(),
  })
  .describe("A stored asset, as its row records it (DATA-11).");
export type Asset = z.infer<typeof assetSchema>;
