import { z } from "zod";

import {
  questionOrderModes,
  timingModes,
} from "@/lib/admin/assignment-settings";

import {
  reviewLevelSchema,
  reviewScopeSchema,
} from "./assignment-request-common";

export const assignmentCapacitySchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    includePendingReview: z.boolean(),
    reviewLevels: z.array(reviewLevelSchema).max(2),
    reviewScope: reviewScopeSchema.optional(),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.includePendingReview && value.reviewLevels.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reviewLevels"],
        message: "포함할 오답 단계를 하나 이상 선택해 주세요.",
      });
    }
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
  });

export const assignmentReplacementPreviewSchema =
  assignmentCapacitySchema;

export const assignmentReplacementSchema = z
  .object({
    idempotencyKey: z.uuid(),
    title: z.string().trim().min(1).max(160),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    includePendingReview: z.boolean(),
    reviewLevels: z.array(reviewLevelSchema).max(2),
    questionCount: z.number().int().min(1).max(500),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    timeLimitSeconds: z.number().int().min(30).max(10800),
    timingMode: z.enum(timingModes),
    questionTimeLimitSeconds: z
      .number()
      .int()
      .min(5)
      .max(600)
      .nullable(),
    passingScore: z.number().int().min(0).max(100),
    retryEnabled: z.boolean(),
    retryPassingScore: z.number().int().min(0).max(100).nullable(),
    questionOrderMode: z.enum(questionOrderModes),
    availableUntil: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.retryEnabled !== (value.retryPassingScore !== null)) {
      context.addIssue({
        code: "custom",
        path: ["retryPassingScore"],
        message: "재시험 사용 여부와 통과 점수를 확인해 주세요.",
      });
    }
    if (value.includePendingReview && value.reviewLevels.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reviewLevels"],
        message: "포함할 오답 단계를 하나 이상 선택해 주세요.",
      });
    }
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
      new Set(value.reviewLevels).size !== value.reviewLevels.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewLevels"],
        message: "같은 오답 단계를 두 번 선택할 수 없습니다.",
      });
    }
    if (
      (value.timingMode === "none" &&
        value.questionTimeLimitSeconds !== null) ||
      (value.timingMode === "total" &&
        value.questionTimeLimitSeconds !== null) ||
      (value.timingMode === "per_question" &&
        value.questionTimeLimitSeconds === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["questionTimeLimitSeconds"],
        message: "시간 제한 방식과 문제당 시간을 확인해주세요.",
      });
    }
  });

export type AssignmentCapacityInput = z.infer<
  typeof assignmentCapacitySchema
>;

export type AssignmentReplacementInput = z.infer<
  typeof assignmentReplacementSchema
>;
