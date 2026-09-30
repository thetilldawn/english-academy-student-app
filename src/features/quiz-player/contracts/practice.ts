import { z } from "zod";
import { notebookFiltersSchema } from "@/features/students/public-contracts";

export const practiceSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("selected"), keys: z.array(z.string().min(1).max(1000)).min(1).max(500).refine(keys => new Set(keys).size === keys.length) }).strict(),
  z.object({ mode: z.literal("filtered"), filters: notebookFiltersSchema }).strict(),
]);
export const practiceSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(500),
  englishToKoreanRatio: z.union([z.literal(0), z.literal(50), z.literal(100)]),
  timingMode: z.enum(["none", "total", "per_question"]),
  timeLimitSeconds: z.number().int().min(30).max(10800).nullable(),
  questionTimeLimitSeconds: z.number().int().min(5).max(600).nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.timingMode === "total") !== (value.timeLimitSeconds !== null) ||
      (value.timingMode === "per_question") !== (value.questionTimeLimitSeconds !== null)) {
    ctx.addIssue({ code: "custom", message: "시간 설정을 확인해 주세요." });
  }
});
export const practicePreviewInputSchema = z.object({
  requestKey: z.uuid(), selection: practiceSelectionSchema, settings: practiceSettingsSchema,
}).strict();
export const practiceStartInputSchema = practicePreviewInputSchema.extend({ confirmation: z.string().regex(/^[a-f0-9]{64}$/) });
export type PracticeSelection = z.infer<typeof practiceSelectionSchema>;
export type PracticeSettings = z.infer<typeof practiceSettingsSchema>;
export type PracticeInput = z.infer<typeof practicePreviewInputSchema>;
export type PracticeStartInput = z.infer<typeof practiceStartInputSchema>;
export const practicePreviewSchema = z.object({
  confirmation: z.string().nullable(), availableCount: z.number().int().nonnegative(), totalCount: z.number().int().nonnegative(),
  words: z.array(z.object({ key: z.string(), headword: z.string(), primaryMeaning: z.string() })),
  excluded: z.array(z.object({ key: z.string(), headword: z.string(), reason: z.string() })), error: z.string().nullable(),
});
export type PracticePreview = z.infer<typeof practicePreviewSchema>;
export const practiceHistorySchema = z.array(z.object({
  id: z.uuid(), startedAt: z.string(), finishedAt: z.string().nullable(), questionCount: z.number().int(),
  correctCount: z.number().int(), status: z.enum(["in_progress", "completed", "expired"]),
}));
export type PracticeHistory = z.infer<typeof practiceHistorySchema>;
export const practiceHistoryPageSchema = z.object({ items: practiceHistorySchema.max(10), nextCursor: z.string().nullable() });
export type PracticeHistoryPage = z.infer<typeof practiceHistoryPageSchema>;
