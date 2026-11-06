import { z } from "zod";

// A workspace's chat (APP-01, APP-03): what the person asked and what Tessera answered, kept with
// the workspace (ADR 0011). It stays with a workspace in the trash, goes when the workspace is
// removed for good, and never goes into an export file.

/** The longest message kept; the host app shortens a longer reply to fit. */
export const CHAT_TEXT_LIMIT = 8000;

/** How many of a workspace's newest messages are kept; older ones go as new ones come. */
export const CHAT_MESSAGES_KEPT = 200;

/** Who said it: the person, or Tessera. */
export const CHAT_SPEAKERS = ["person", "tessera"] as const;
export type ChatSpeaker = (typeof CHAT_SPEAKERS)[number];

/** A message to add: who said it and what, as the person read it. */
export const chatEntrySchema = z.strictObject({
  from: z.enum(CHAT_SPEAKERS),
  text: z.string().trim().min(1).max(CHAT_TEXT_LIMIT),
});
export type ChatEntry = z.infer<typeof chatEntrySchema>;

/** A kept message, with its number in the workspace's chat and when it was added. */
export const chatMessageSchema = chatEntrySchema.extend({
  number: z.int().min(1).describe("Its place in the workspace's chat, counting from 1."),
  at: z.iso.datetime().describe("When it was added."),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
