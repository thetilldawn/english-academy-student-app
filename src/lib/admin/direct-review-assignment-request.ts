import { z } from "zod";

import { questionOrderModes } from "@/lib/admin/assignment-settings";

import {
  mixedAssignmentBaseSchema,
  refineMixedAssignmentSettings,
  timingSettingsSchema,
  validateRetrySettings,
} from "./assignment-request-common";

export const exactReviewAssignmentSchema = z
  .object({
    reviewDraftId: z.uuid(),
    title: z.string().trim().max(160).default(""),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    timeLimitSeconds: z.coerce.number().int().min(30).max(10800),
    passingScore: z.coerce.number().int().min(0).max(100),
    retryEnabled: z.boolean(),
    retryPassingScore: z.coerce.number().int().min(0).max(100).nullable(),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    availableUntil: z
      .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
  })
  .strict()
  .and(timingSettingsSchema)
  .superRefine(validateRetrySettings);

export const directReviewAssignmentSchema = mixedAssignmentBaseSchema
  .extend({
    idempotencyKey: z.uuid(),
    totalQuestionCount: z.number().int().min(1).max(500),
  })
  .superRefine(refineMixedAssignmentSettings)
  .superRefine((value, context) => {
    if (value.totalQuestionCount > 400) {
      context.addIssue({
        code: "custom",
        path: ["totalQuestionCount"],
        message: "오답 시험은 한 번에 400문항까지 배정할 수 있습니다.",
      });
    }
    if (value.reviewScope !== "dataset") {
      context.addIssue({
        code: "custom",
        path: ["reviewScope"],
        message: "오답 시험은 선택한 단어장 전체 오답으로 배정해 주세요.",
      });
    }
  });

export type DirectReviewAssignmentInput = z.infer<
  typeof directReviewAssignmentSchema
>;
