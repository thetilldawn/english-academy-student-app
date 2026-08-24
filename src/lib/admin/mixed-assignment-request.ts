import { z } from "zod";

import {
  mixedAssignmentBaseSchema,
  refineMixedAssignmentSettings,
  reviewLevelSchema,
  reviewScopeSchema,
} from "./assignment-request-common";

export const mixedAssignmentPreviewSchema = z
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
  })
  .strict()
  .superRefine((value, context) => {
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

export const mixedAssignmentSchema = mixedAssignmentBaseSchema.superRefine(
  refineMixedAssignmentSettings,
);

export type MixedAssignmentInput = z.infer<
  typeof mixedAssignmentSchema
>;

export type MixedAssignmentPreviewInput = z.infer<
  typeof mixedAssignmentPreviewSchema
>;
