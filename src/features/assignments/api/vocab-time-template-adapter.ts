import { z } from "zod";

import type { ExamTiming } from "../domain/model";
import type { VocabTimeTemplate } from "../domain/vocab-assignment-plan";

const templateSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(30),
    availableTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    deadlineDayOffset: z.number().int().min(0).max(30),
    deadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timingMode: z.enum(["total", "per_question"]),
    totalSeconds: z.number().int().min(30).max(10800).nullable(),
    perQuestionSeconds: z.number().int().min(5).max(600).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const valid = value.timingMode === "total"
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

const createResponseSchema = z
  .object({ template: templateSchema })
  .strict();

export type VocabTimeTemplateRecord = z.infer<typeof templateSchema>;

export function toVocabTimeTemplate(
  record: VocabTimeTemplateRecord,
): VocabTimeTemplate {
  const timing: ExamTiming = record.timingMode === "total"
    ? { mode: "total", totalSeconds: record.totalSeconds! }
    : {
        mode: "per_question",
        perQuestionSeconds: record.perQuestionSeconds!,
      };
  return {
    id: record.id,
    label: record.name,
    availableTime: record.availableTime,
    deadlineDayOffset: record.deadlineDayOffset,
    deadlineTime: record.deadlineTime,
    timing,
  };
}

export function parseCreatedVocabTimeTemplate(value: unknown) {
  return toVocabTimeTemplate(createResponseSchema.parse(value).template);
}

export function buildVocabTimeTemplateRequest(input: {
  name: string;
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
  timing: ExamTiming;
}) {
  return {
    name: input.name,
    availableTime: input.availableTime,
    deadlineDayOffset: input.deadlineDayOffset,
    deadlineTime: input.deadlineTime,
    timingMode: input.timing.mode,
    totalSeconds: input.timing.mode === "total" ? input.timing.totalSeconds : null,
    perQuestionSeconds:
      input.timing.mode === "per_question"
        ? input.timing.perQuestionSeconds
        : null,
  };
}
