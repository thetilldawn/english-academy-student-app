import { z } from "zod";

export const vocabTimeTemplateRecordSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(30),
    availableTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    deadlineDayOffset: z.number().int().min(0).max(30),
    deadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timingMode: z.enum(["none", "total", "per_question"]),
    totalSeconds: z.number().int().min(30).max(10800).nullable(),
    perQuestionSeconds: z.number().int().min(5).max(600).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const valid = value.timingMode === "none"
      ? value.totalSeconds === null && value.perQuestionSeconds === null
      : value.timingMode === "total"
        ? value.totalSeconds !== null && value.perQuestionSeconds === null
        : value.totalSeconds === null && value.perQuestionSeconds !== null;
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["timingMode"],
        message: "제한시간 조합이 올바르지 않습니다.",
      });
    }
  });

export type VocabTimeTemplateRecord = z.infer<
  typeof vocabTimeTemplateRecordSchema
>;
