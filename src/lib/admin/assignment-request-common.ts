import { z } from "zod";

import {
  questionOrderModes,
  timingModes,
  type TimingMode,
} from "@/lib/admin/assignment-settings";

export function validateTimingSettings(
  value: {
    timingMode?: TimingMode;
    questionTimeLimitSeconds?: number | null;
  },
  context: z.RefinementCtx,
) {
  if (
    (value.timingMode === "none" &&
      value.questionTimeLimitSeconds !== null &&
      value.questionTimeLimitSeconds !== undefined) ||
    (value.timingMode === "total" &&
      value.questionTimeLimitSeconds !== null &&
      value.questionTimeLimitSeconds !== undefined) ||
    (value.timingMode === "per_question" &&
      (value.questionTimeLimitSeconds === null ||
        value.questionTimeLimitSeconds === undefined)) ||
    (value.timingMode === undefined &&
      value.questionTimeLimitSeconds !== null &&
      value.questionTimeLimitSeconds !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      path: ["questionTimeLimitSeconds"],
      message: "시간 제한 방식과 문제당 시간을 확인해 주세요.",
    });
  }
}

export const timingSettingsSchema = z
  .object({
    timingMode: z.enum(timingModes).optional(),
    questionTimeLimitSeconds: z
      .number()
      .int()
      .min(5)
      .max(600)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    validateTimingSettings(value, context);
  });

export function validateRetrySettings(
  value: { retryEnabled: boolean; retryPassingScore: number | null },
  context: z.RefinementCtx,
) {
  if (value.retryEnabled !== (value.retryPassingScore !== null)) {
    context.addIssue({
      code: "custom",
      path: ["retryPassingScore"],
      message: "재시험 사용 여부와 통과 점수를 확인해 주세요.",
    });
  }
}

export const reviewLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
]);

export const reviewScopeSchema = z.enum(["dataset", "selection"]);

export const mixedAssignmentBaseSchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    reviewLevels: z.array(reviewLevelSchema).min(1).max(2),
    reviewScope: reviewScopeSchema.optional(),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    totalQuestionCount: z.number().int().min(4).max(500),
    title: z.string().trim().max(160).default(""),
    timeLimitSeconds: z.number().int().min(30).max(10800),
    passingScore: z.number().int().min(0).max(100),
    retryEnabled: z.boolean(),
    retryPassingScore: z.number().int().min(0).max(100).nullable(),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    availableUntil: z.iso.datetime({ offset: true }).nullable(),
    timingMode: z.enum(timingModes).optional(),
    questionTimeLimitSeconds: z
      .number()
      .int()
      .min(5)
      .max(600)
      .nullable()
      .optional(),
  })
  .strict();

export function refineMixedAssignmentSettings(
  value: z.infer<typeof mixedAssignmentBaseSchema>,
  context: z.RefinementCtx,
) {
  validateRetrySettings(value, context);
  if (
    new Set(value.primaryUnitIds).size !==
    value.primaryUnitIds.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["primaryUnitIds"],
      message: "같은 범위를 두 번 선택할 수 없습니다.",
    });
  }
  if (
    new Set(value.reviewLevels).size !==
    value.reviewLevels.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["reviewLevels"],
      message: "같은 오답 단계를 두 번 선택할 수 없습니다.",
    });
  }
  validateTimingSettings(value, context);
}
