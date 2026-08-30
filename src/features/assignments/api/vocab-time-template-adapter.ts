import { z } from "zod";

import type { ExamTiming } from "../domain/model";
import type { VocabTimeTemplate } from "../domain/vocab-assignment-contract";
import {
  vocabTimeTemplateRecordSchema,
  type VocabTimeTemplateRecord,
} from "../contracts/vocab-time-template-contract";

const createResponseSchema = z
  .object({ template: vocabTimeTemplateRecordSchema })
  .strict();

export type { VocabTimeTemplateRecord } from "../contracts/vocab-time-template-contract";

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
