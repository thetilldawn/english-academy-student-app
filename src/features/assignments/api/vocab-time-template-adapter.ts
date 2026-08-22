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

const createResponseSchema = z
  .object({ template: templateSchema })
  .strict();

export type VocabTimeTemplateRecord = z.infer<typeof templateSchema>;

export function toVocabTimeTemplate(
  record: VocabTimeTemplateRecord,
): VocabTimeTemplate {
  const timing: ExamTiming = record.timingMode === "per_question"
    ? {
        mode: "per_question",
        perQuestionSeconds: record.perQuestionSeconds!,
      }
    : { mode: "total", totalSeconds: record.totalSeconds ?? 300 };
  return {
    id: record.id,
    label: record.name,
    availableTime: record.availableTime,
    deadlineDayOffset: record.deadlineDayOffset,
    deadlineTime: record.deadlineTime,
    timeLimitEnabled: record.timingMode !== "none",
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
  timeLimitEnabled?: boolean;
  timing: ExamTiming;
}) {
  return {
    name: input.name,
    availableTime: input.availableTime,
    deadlineDayOffset: input.deadlineDayOffset,
    deadlineTime: input.deadlineTime,
    timingMode: input.timeLimitEnabled !== false ? input.timing.mode : "none",
    totalSeconds: input.timeLimitEnabled !== false && input.timing.mode === "total" ? input.timing.totalSeconds : null,
    perQuestionSeconds:
      input.timeLimitEnabled !== false && input.timing.mode === "per_question"
        ? input.timing.perQuestionSeconds
        : null,
  };
}
