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

export const libraryResourceV1Schema = z.object({
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

const proofNames = ["audio", "definition", "dictionary_entry", "dictionary_sense", "example_en", "example_ko", "lexical_pos", "pronunciation_ko", "pronunciation_pos", "pronunciation_variant", "stress", "source.headword", "source.meaning", "source.pos", "source.display_headword", "source.display_meaning"] as const;
export const vocabularyProofMetadataSchema = z.object({
  state: z.enum(["linked", "absent", "review_required", "excluded"]),
  ref: z.object({ fileHash: libraryHashSchema, valueHash: libraryHashSchema,
    pointer: z.string(), line: z.number().int().positive().nullable() }).strict().nullable(),
}).strict().refine(proof => proof.state !== "linked" || proof.ref !== null,
  { message: "연결 근거를 확인하지 못했습니다." });
export const vocabularyProofsSchema = z.partialRecord(z.enum(proofNames), vocabularyProofMetadataSchema);
export const vocabularyDictionaryLinkSchema = z.object({
  dictionary_id: z.string().min(1), legacy_id: z.uuid().nullable().optional(),
  sense_id: z.string().nullable().optional(), canonical_approved: z.boolean().optional(),
  occurrence_id: z.string().optional(),
}).strict().nullable();

// Only the new selected-value contract tightens literal URL spelling. Historical
// v1 parsing remains unchanged. These checks match the SQL registration guard.
const rawAudioUrlV2 = /^(?:https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3|https:\/\/[a-z0-9]{20}\.supabase\.co\/storage\/v1\/object\/public\/vocab-pronunciation-audio\/[^?#\s]*)$/;
export const learningPronunciationSchema = frozenPronunciationSchema.refine(p =>
  p.audioUrl === null || (rawAudioUrlV2.test(p.audioUrl) && !p.audioUrl.includes("\\") && !/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(p.audioUrl)));
export const librarySelectedResourceV2Schema = z.object({
  schemaVersion: z.literal("vocabulary-resource-selected-v2"),
  pronunciation: learningPronunciationSchema, lexicalPos: z.string().nullable(),
  dictionary: vocabularyDictionaryLinkSchema, senseId: z.string().nullable(),
  definitionEn: z.string().nullable(), exampleEn: z.string().nullable(), exampleKo: z.string().nullable(),
  proofs: vocabularyProofsSchema,
}).strict();
export const vocabularyResourceReferenceSchema = z.object({
  schemaVersion: z.literal("vocabulary-resource-ref-v2"), selectionId: z.uuid(), selectionHash: libraryHashSchema,
}).strict();
export const vocabularyBindingReferenceSchema = z.object({
  schemaVersion: z.literal("vocabulary-source-binding-ref-v1"), bindingId: z.uuid(), bindingHash: libraryHashSchema,
}).strict();
export const libraryResourceSchema = z.discriminatedUnion("schemaVersion", [libraryResourceV1Schema, librarySelectedResourceV2Schema]);
export type LibraryResource = z.infer<typeof libraryResourceSchema>;
