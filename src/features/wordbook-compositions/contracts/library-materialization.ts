import { z } from "zod";
import { libraryHashSchema } from "./library";
import { libraryResourceSchema } from "./library-resources";
import { reviewedChoiceSafetySchema } from "@/lib/quiz/choice-safety";

export const materializeLibrarySchema = z.object({
  action: z.literal("materialize"), versionId: z.uuid(), contentHash: libraryHashSchema,
}).strict();
const direction = z.enum(["english_to_korean", "korean_to_english"]);
const compositionHeaderSchema = z.object({
  versionId: z.uuid(), datasetId: z.uuid(), contentHash: libraryHashSchema, state: z.enum(["preparing", "ready"]),
}).strict();
const compositionEntrySchema = z.object({
  choiceSafety: reviewedChoiceSafetySchema.optional(),
  id: z.number().int().positive().safe(), unitId: z.uuid(), sourceRow: z.number().int().positive(),
  headword: z.string().min(1), primaryMeaning: z.string().min(1),
  sourceKind: z.enum(["legacy_vocab", "exam_use", "reviewed_exam"]), sourceEntryId: z.number().int().positive().safe(),
  eligibleDirections: z.array(direction).max(2), compositionTargetKey: libraryHashSchema, resources: libraryResourceSchema,
}).strict();
const uniqueEntryIds = (p: { entries: { id: number }[] }) => new Set(p.entries.map(e => e.id)).size === p.entries.length;
export const compositionPreparationSchema = compositionHeaderSchema.extend({
  entries: z.array(compositionEntrySchema).min(1).max(20000),
}).refine(uniqueEntryIds);
export type CompositionPreparation = z.infer<typeof compositionPreparationSchema>;
export const compositionQuestionInputSchema = compositionHeaderSchema.extend({
  entries: z.array(compositionEntrySchema.omit({ resources: true })).min(1).max(20000),
}).refine(uniqueEntryIds);
export type CompositionQuestionInput = z.infer<typeof compositionQuestionInputSchema>;
export const compositionCompletionSummarySchema = z.object({
  versionId: z.uuid(), datasetId: z.uuid(), contentHash: libraryHashSchema, state: z.literal("ready"),
  entryCount: z.number().int().min(1).max(20000), questionCount: z.number().int().min(0).max(40000),
}).strict();
const compositionStepFields = {
  stage: z.enum(["entries", "reviewed", "prepared", "questions", "complete"]),
  done: z.number().int().min(0).max(40000), total: z.number().int().min(0).max(40000), needsQuestions: z.boolean(),
};
export const compositionStepSchema = compositionHeaderSchema.extend(compositionStepFields).refine(s =>
  s.done <= s.total && (s.state === "ready") === (s.stage === "complete") && (!s.needsQuestions || s.stage === "prepared"));
export type CompositionStep = z.infer<typeof compositionStepSchema>;
export const compositionProgressSchema = compositionHeaderSchema.extend({
  ...compositionStepFields, kind: z.literal("materializing"), requestId: z.uuid(), templateId: z.uuid(), state: z.literal("preparing"),
}).refine(s => s.done <= s.total && s.stage !== "complete" && (!s.needsQuestions || s.stage === "prepared"));
