import { z } from "zod";
import { wrongWordFiltersSchema } from "./wrong-word-filters";
import { notebookPronunciationSchema } from "./notebook-study";
import { mistakeEpisodeIdSchema, mistakeEpisodeSchema, mistakeSequenceSchema } from "./mistake-episode-history";

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const sequence = mistakeSequenceSchema;
export const mistakeFiltersSchema = wrongWordFiltersSchema.safeExtend({
  view: z.enum(["current", "history"]).default("current"),
  sort: z.enum(["count", "recent"]).default("count"),
});
export type MistakeFilters = z.infer<typeof mistakeFiltersSchema>;
export const mistakeCursorSchema = z.object({
  studentId: z.uuid(), filtersHash: z.string().regex(/^[a-f0-9]{64}$/), stateVersion: sequence,
  sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.string().min(1).max(1000), count, lastWrongAt: timestamp,
}).strict();
export const mistakeTargetSchema = z.object({
  sourceQuestionId: z.uuid(), sourcePhase: z.enum(["initial", "retry"]),
  meaningKey: z.string().regex(/^[a-f0-9]{64}$/), episodeId: mistakeEpisodeIdSchema, stateVersion: sequence,
}).strict();
export type MistakeTarget = z.infer<typeof mistakeTargetSchema>;
export const queueMistakesSchema = z.object({ targets: z.array(mistakeTargetSchema).min(1).max(500) }).strict()
  .refine(value => new Set(value.targets.map(target => target.meaningKey)).size === value.targets.length,
    { message: "같은 뜻을 두 번 선택할 수 없습니다.", path: ["targets"] });
const counters = { currentWrongCount: count, lifetimeWrongCount: count, currentMissedCount: count, lifetimeMissedCount: count };
const sourceSchema = z.object({ datasetId: z.uuid(), entryId: z.number().int().positive(), label: z.string(), ...counters, lastWrongAt: timestamp });
export const mistakeMeaningSchema = z.object({
  meaningKey: z.string().regex(/^[a-f0-9]{64}$/), episodeId: mistakeEpisodeIdSchema.nullable(), stateVersion: sequence,
  ...counters, legacyWrongCount: count, countQuality: z.enum(["exact", "legacy-continuation"]),
  unresolved: z.boolean(), resolvedAt: timestamp.nullable(), lastWrongAt: timestamp,
  testedField: z.enum(["primary_meaning", "definition", "example"]), identityKind: z.string(),
  selectedText: z.string(), primaryMeaning: z.string(),
  episodeCount: count, episodes: z.array(mistakeEpisodeSchema).max(20), episodeNextCursor: z.string().nullable(),
  sourceEntryId: z.number().int().positive(), sourceDatasetId: z.uuid(), sourceLabel: z.string(), sources: z.array(sourceSchema),
});
export const adminMistakeMeaningSchema = mistakeMeaningSchema.extend({
  queueId: z.uuid().nullable(), reviewDraftId: z.uuid().nullable(), isCurrentEpisode: z.boolean(),
  scheduling: z.enum(["available", "queued", "assigned", "none"]),
  activeAssignment: z.object({ assignmentId: z.uuid(), title: z.string(), assignedAt: timestamp }).nullable(),
  sourceQuestionId: z.uuid(), sourceAttemptId: z.uuid(), sourcePhase: z.enum(["initial", "retry"]),
  sources: z.array(sourceSchema.extend({ sourceQuestionId: z.uuid(), sourcePhase: z.enum(["initial", "retry"]), episodeId: mistakeEpisodeIdSchema.nullable() })),
});
export const mistakeWordSchema = z.object({
  sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.string().min(1), headword: z.string(), primaryMeaning: z.string(), ...counters,
  legacyWrongCount: count, lastWrongAt: timestamp, meanings: z.array(mistakeMeaningSchema).min(1),
});
export const adminMistakeWordSchema = mistakeWordSchema.extend({ meanings: z.array(adminMistakeMeaningSchema).min(1) });
export const mistakeSummarySchema = z.object({ wordCount: count, currentWrongCount: count, lifetimeWrongCount: count, currentMissedCount: count, legacyWrongCount: count });
const pageFields = {
  sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
  view: z.enum(["current", "history"]), stateVersion: sequence, totalCount: count.nullable(), nextCursor: z.string().nullable(),
  summary: mistakeSummarySchema.nullable(), datasetOptions: z.array(z.object({ id: z.uuid(), label: z.string() })).nullable(),
};
export const mistakePageSchema = z.object({ ...pageFields, items: z.array(mistakeWordSchema).max(10) });
export const adminMistakePageSchema = z.object({ ...pageFields, items: z.array(adminMistakeWordSchema).max(10),
  schedulingBasis: z.literal("current"), schedulingAsOf: timestamp,
  reviewDrafts: z.array(z.object({ draftId: z.uuid(), datasetId: z.uuid(), questionCount: count })).nullable(),
});
export type MistakePage = z.infer<typeof mistakePageSchema>;
export type AdminMistakePage = z.infer<typeof adminMistakePageSchema>;
export type AdminMistakePageView = Omit<AdminMistakePage, "summary" | "totalCount" | "datasetOptions" | "reviewDrafts"> & {
  filters: MistakeFilters; summary: NonNullable<AdminMistakePage["summary"]>; totalCount: number;
  datasetOptions: NonNullable<AdminMistakePage["datasetOptions"]>; reviewDrafts: NonNullable<AdminMistakePage["reviewDrafts"]>;
};
export type MistakeWord = z.infer<typeof mistakeWordSchema>;
export type AdminMistakeMeaning = z.infer<typeof adminMistakeMeaningSchema>;
export const mistakeStudyWordSchema = mistakeWordSchema.extend({
  pronunciation: notebookPronunciationSchema, definition: z.string().nullable(), example: z.string().nullable(), exampleKo: z.string().nullable(),
});
export const mistakeStudyPageSchema = mistakePageSchema.extend({ items: z.array(mistakeStudyWordSchema).max(10) });
export type MistakeStudyWord = z.infer<typeof mistakeStudyWordSchema>;
export type MistakeStudyPage = z.infer<typeof mistakeStudyPageSchema>;

export function mistakeFilterKey(filters: MistakeFilters) {
  return JSON.stringify([filters.view, filters.sort, filters.datasetId, filters.level, filters.query.trim(), filters.minWrongCount ?? null, filters.maxWrongCount ?? null]);
}
export function mistakeTarget(meaning: AdminMistakeMeaning): MistakeTarget | null {
  if (!meaning.unresolved || !meaning.episodeId || !meaning.isCurrentEpisode) return null;
  const { sourceQuestionId, sourcePhase, meaningKey, episodeId, stateVersion } = meaning;
  return mistakeTargetSchema.parse({ sourceQuestionId, sourcePhase, meaningKey, episodeId, stateVersion });
}
