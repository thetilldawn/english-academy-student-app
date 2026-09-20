import { z } from "zod";
import { libraryHashSchema } from "./library";

const audioUrl = z.url().refine(value => {
  const u = new URL(value);
  return /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/.test(value) ||
    u.protocol === "https:" && /^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname) &&
    u.pathname.startsWith("/storage/v1/object/public/vocab-pronunciation-audio/") && !u.search && !u.hash && !u.username && !u.password;
});
export const frozenPronunciationSchema = z.object({
  displayKo: z.string().min(1).max(500).nullable(),
  segments: z.array(z.object({ text: z.string().min(1).max(100), stress: z.enum(["none", "secondary", "primary"]) }).strict()).max(100).optional(),
  variantId: z.string().min(1).max(500).nullable(), audioUrl: audioUrl.nullable(), available: z.boolean(),
}).strict().refine(p => p.available === (p.audioUrl !== null))
  .refine(p => !p.segments?.length || p.segments.map(s => s.text).join("") === p.displayKo);

export const frozenQuestionPronunciationSchema = z.object({
  target: frozenPronunciationSchema, choices: z.array(frozenPronunciationSchema).length(4),
}).strict();
export type FrozenQuestionPronunciation = z.infer<typeof frozenQuestionPronunciationSchema>;

export const libraryResourceSchema = z.object({
  schemaVersion: z.literal("vocabulary-resource-snapshot-v1"),
  sourceFields: z.record(z.string(), z.unknown()),
  proofs: z.record(z.string(), z.object({
    state: z.enum(["linked", "absent", "review_required", "excluded"]), value: z.unknown(),
    ref: z.object({ fileHash: libraryHashSchema, valueHash: libraryHashSchema,
      pointer: z.string(), line: z.number().int().positive().nullable() }).strict().nullable(),
  }).strict()),
  pronunciation: frozenPronunciationSchema,
  lexicalPos: z.string().nullable(), dictionary: z.unknown(), senseId: z.string().nullable(),
  definitionEn: z.string().nullable(), exampleEn: z.string().nullable(), exampleKo: z.string().nullable(),
}).strict();
export type LibraryResource = z.infer<typeof libraryResourceSchema>;
