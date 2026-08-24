import { z } from "zod";

import {
  questionOrderModes,
  timingModes,
} from "@/lib/admin/assignment-settings";

import {
  reviewLevelSchema,
  validateRetrySettings,
  validateTimingSettings,
} from "./assignment-request-common";

function validateReviewLevels(
  reviewLevels: readonly (1 | 2)[],
  context: z.RefinementCtx,
) {
  if (new Set(reviewLevels).size !== reviewLevels.length) {
    context.addIssue({
      code: "custom",
      path: ["reviewLevels"],
      message: "같은 오답 단계를 두 번 선택할 수 없습니다.",
    });
  }
}

export const directReviewPreviewSchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    reviewLevels: z.array(reviewLevelSchema).min(1).max(2),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    validateReviewLevels(value.reviewLevels, context);
  });

const directReviewAssignmentBaseSchema = z
  .object({
    idempotencyKey: z.uuid(),
    studentId: z.uuid(),
    datasetId: z.uuid(),
    reviewLevels: z.array(reviewLevelSchema).min(1).max(2),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    totalQuestionCount: z.number().int().min(1).max(500),
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

export const directReviewAssignmentSchema = directReviewAssignmentBaseSchema
  .superRefine((value, context) => {
    validateRetrySettings(value, context);
    validateReviewLevels(value.reviewLevels, context);
    if (value.totalQuestionCount > 400) {
      context.addIssue({
        code: "custom",
        path: ["totalQuestionCount"],
        message: "오답 시험은 한 번에 400개까지 배정할 수 있습니다.",
      });
    }
    validateTimingSettings(value, context);
  });

export type DirectReviewPreviewInput = z.infer<
  typeof directReviewPreviewSchema
>;

export type DirectReviewAssignmentInput = z.infer<
  typeof directReviewAssignmentSchema
>;
