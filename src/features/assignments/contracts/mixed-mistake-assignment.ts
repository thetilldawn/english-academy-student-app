import { z } from "zod";
import { mixedAssignmentBaseSchema, refineMixedAssignmentSettings } from "@/lib/admin/assignment-request-common";
import { notebookAssignmentResultSchema } from "./notebook-assignment";

const version = z.literal("meaning-episode-v1");
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(20000);
const settings = mixedAssignmentBaseSchema.extend({
  planVersion: version,
  reviewScope: z.enum(["dataset", "selection"]).default("dataset"),
  timingMode: z.enum(["none", "total", "per_question"]).default("total"),
  questionTimeLimitSeconds: z.number().int().min(5).max(600).nullable().default(null),
});
export const mixedMistakePreviewInputSchema = settings.superRefine(refineMixedAssignmentSettings);
export const mixedMistakeSaveSchema = settings.extend({
  idempotencyKey: z.uuid(), selectionFingerprint: fingerprint,
  excludeUnavailableConfirmed: z.boolean(), banksConfirmed: z.boolean(),
}).superRefine(refineMixedAssignmentSettings);
export type MixedMistakePreviewInput = z.infer<typeof mixedMistakePreviewInputSchema>;
export type MixedMistakeSave = z.infer<typeof mixedMistakeSaveSchema>;
export function toMixedMistakePreviewInput(value: MixedMistakePreviewInput): MixedMistakePreviewInput {
  return mixedMistakePreviewInputSchema.parse(Object.fromEntries(Object.keys(settings.shape).map(key => [key, Reflect.get(value, key)])));
}

export const mixedMistakeBankSchema = z.object({
  index: z.number().int().min(0).max(499), questionCount: z.number().int().min(1).max(500),
  primaryQuestionCount: count, reviewMeaningCount: count, quizContentMode: z.string().min(1),
  englishToKoreanRatio: z.union([z.literal(0), z.literal(50), z.literal(100)]),
  timeLimitSeconds: z.number().int().min(30).max(10800).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.primaryQuestionCount + value.reviewMeaningCount !== value.questionCount) {
    ctx.addIssue({ code: "custom", message: "시험별 문항 수가 맞지 않습니다." });
  }
});
export const mixedMistakePreviewSchema = z.object({
  planVersion: version, selectionFingerprint: fingerprint.nullable(),
  totalQuestionCount: z.number().int().min(4).max(500), primaryQuestionCount: count, reviewMeaningCount: count,
  availablePrimaryCount: count, candidateReviewCount: count, unavailableCount: count,
  unavailableItems: z.array(z.object({ key: z.string(), headword: z.string(), reason: z.string() }).strict()).max(500),
  banks: z.array(mixedMistakeBankSchema).max(500), error: z.string().min(1).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.error !== null) {
    if (value.selectionFingerprint !== null || value.banks.length) ctx.addIssue({ code: "custom", message: "완성되지 않은 계획입니다." });
    return;
  }
  if (!value.selectionFingerprint || !value.banks.length || value.reviewMeaningCount < 1 ||
    value.primaryQuestionCount + value.reviewMeaningCount !== value.totalQuestionCount ||
    value.banks.some((bank, index) => bank.index !== index) ||
    value.banks.reduce((sum, bank) => sum + bank.questionCount, 0) !== value.totalQuestionCount ||
    value.banks.reduce((sum, bank) => sum + bank.primaryQuestionCount, 0) !== value.primaryQuestionCount ||
    value.banks.reduce((sum, bank) => sum + bank.reviewMeaningCount, 0) !== value.reviewMeaningCount) {
    ctx.addIssue({ code: "custom", message: "배정 계획의 문항 수를 확인하지 못했습니다." });
  }
});
export type MixedMistakePreview = z.infer<typeof mixedMistakePreviewSchema>;
export const mixedMistakeResultSchema = z.object({
  planVersion: version, kind: z.literal("mistake_batch"), assignments: notebookAssignmentResultSchema,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.assignments.map(item => item.assignmentId)).size !== value.assignments.length ||
    new Set(value.assignments.map(item => item.studentId)).size !== 1) {
    ctx.addIssue({ code: "custom", message: "혼합 배정 결과를 확인하지 못했습니다." });
  }
});
export type MixedMistakeResult = z.infer<typeof mixedMistakeResultSchema>;
