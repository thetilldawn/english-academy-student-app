import { z } from "zod";

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const activeAssignment = z.object({ assignmentId: z.uuid(), title: z.string(), assignedAt: timestamp }).nullable();
const resolution = z.enum(["unresolved", "resolved"]);
const scheduling = z.enum(["available", "queued", "assigned", "none"]);
export const wrongWordItemSchema = z.object({
  key: z.string().min(1),
  canonicalDictionaryId: z.string().nullable(), canonicalLexemeId: z.uuid().nullable(),
  headword: z.string(), primaryMeaning: z.string(), wrongCount: count,
  wrongLevel: z.union([z.literal(1), z.literal(2)]), lastWrongAt: timestamp,
  latestAttemptId: z.uuid(), latestQuestionId: z.uuid(), latestDatasetId: z.uuid(), latestVocabEntryId: z.number().int().positive(),
  latestOutcome: z.enum(["recovered_on_retry", "wrong_again", "retry_unanswered"]),
  resolution, scheduling, activeAssignment,
  occurrences: z.array(z.object({
    datasetId: z.uuid(), vocabEntryId: z.number().int().positive(), latestQuestionId: z.uuid(), datasetLabel: z.string(),
    headword: z.string(), primaryMeaning: z.string(),
    provenanceStatus: z.enum(["legacy_backfill", "verified_v2", "reviewed_for_preview_v1", "preview_verified_v1", "exam_reviewed_v1", "composition_verified_v1"]),
    wrongCount: count, lastWrongAt: timestamp, resolution, scheduling, activeAssignment,
  })).min(1),
});
export const wrongWordSummarySchema = z.object({
  wrongEventCount: count, uniqueWordCount: count, onceWrongWordCount: count,
  repeatedWrongWordCount: count, pendingReviewCount: count,
});
export const wrongWordFiltersSchema = z.object({
  datasetId: z.union([z.uuid(), z.literal("")]).default(""),
  level: z.enum(["all", "once", "repeated"]).default("all"),
  query: z.string().trim().max(200).default(""),
}).strict();
export type WrongWordPageFilters = z.infer<typeof wrongWordFiltersSchema>;
export const wrongWordPageSchema = z.object({
  items: z.array(wrongWordItemSchema).max(10), nextCursor: z.string().nullable(),
  totalCount: count.nullable(), summary: wrongWordSummarySchema.nullable(),
  datasetOptions: z.array(z.object({ id: z.uuid(), label: z.string() })).nullable(),
  reviewDrafts: z.array(z.object({ draftId: z.uuid(), datasetId: z.uuid(), questionCount: count })).nullable(),
});
export type WrongWordPage = z.infer<typeof wrongWordPageSchema>;
/** One student's currently loaded pages; summary always covers the entire history. */
export type WrongWordPageView = Omit<WrongWordPage, "summary" | "datasetOptions" | "reviewDrafts" | "totalCount"> & {
  filters: WrongWordPageFilters;
  summary: NonNullable<WrongWordPage["summary"]>;
  datasetOptions: NonNullable<WrongWordPage["datasetOptions"]>;
  reviewDrafts: NonNullable<WrongWordPage["reviewDrafts"]>;
  totalCount: number;
};
