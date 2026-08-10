import { z } from "zod";

const nonNegativeInteger = z.number().int().nonnegative();

const assignmentCapacityResponseSchema = z
  .object({
    eligibleBeforeActiveAssignment: nonNegativeInteger,
    activeAssignmentExcluded: nonNegativeInteger,
    questionPlanExcluded: nonNegativeInteger,
    unitEligible: nonNegativeInteger,
    wrongEligible: nonNegativeInteger,
    wrongLevel1Eligible: nonNegativeInteger,
    wrongLevel2Eligible: nonNegativeInteger,
    overlap: nonNegativeInteger,
    alreadyAssigned: nonNegativeInteger,
    maximumQuestionCount: nonNegativeInteger,
    recommendedQuestionCount: nonNegativeInteger,
    minimumQuestionCount: nonNegativeInteger,
  })
  .strict();

const assignmentCreationResponseSchema = z
  .object({ assignmentId: z.uuid() })
  .strict();

const assignmentReplacementResponseSchema = z
  .object({
    status: z.literal("replaced"),
    sourceAssignmentId: z.uuid(),
    replacementAssignmentId: z.uuid(),
    studentId: z.uuid(),
    replacementPurpose: z.enum(["regular", "mixed", "review"]),
    idempotent: z.boolean(),
  })
  .strict();

const assignmentEditDraftResponseSchema = z
  .object({
    assignmentId: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    purpose: z.enum(["regular", "mixed", "review"]),
    title: z.string().max(160),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    questionCount: z.number().int().min(1).max(500),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    timeLimitSeconds: z.number().int().min(30).max(10800),
    timingMode: z.enum(["total", "per_question"]),
    questionTimeLimitSeconds: z.number().int().min(5).max(600).nullable(),
    passingScore: z.number().int().min(0).max(100),
    questionOrderMode: z.enum([
      "ascending",
      "descending",
      "random",
      "fixed",
    ]),
    availableUntil: z.iso.datetime({ offset: true }).nullable(),
    includePendingReview: z.boolean(),
    reviewLevels: z.array(z.union([z.literal(1), z.literal(2)])).max(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.primaryUnitIds).size !== value.primaryUnitIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryUnitIds"],
        message: "같은 DAY가 중복된 수정 응답입니다.",
      });
    }
    if (new Set(value.reviewLevels).size !== value.reviewLevels.length) {
      context.addIssue({
        code: "custom",
        path: ["reviewLevels"],
        message: "같은 오답 단계가 중복된 수정 응답입니다.",
      });
    }
    if (
      (value.timingMode === "total" &&
        value.questionTimeLimitSeconds !== null) ||
      (value.timingMode === "per_question" &&
        value.questionTimeLimitSeconds === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["questionTimeLimitSeconds"],
        message: "시간 제한 방식과 문제당 시간을 확인해 주세요.",
      });
    }
  });

const bulkPreviewSessionSchema = z
  .object({
    sessionNumber: z.number().int().positive(),
    available: z.boolean(),
    unitId: z.uuid().nullable(),
    unitLabel: z.string().nullable(),
    unitIds: z.array(z.uuid()),
    unitLabels: z.array(z.string()),
    rangeTruncated: z.boolean(),
    questionCount: nonNegativeInteger,
    wrongCount: nonNegativeInteger,
    availableFrom: z.iso.datetime({ offset: true }),
    availableUntil: z.iso.datetime({ offset: true }).nullable(),
    error: z.string().nullable(),
  })
  .strict();

const bulkAssignmentPreviewResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          studentId: z.uuid(),
          studentName: z.string(),
          available: z.boolean(),
          datasetId: z.uuid().nullable(),
          datasetLabel: z.string().nullable(),
          sessions: z.array(bulkPreviewSessionSchema),
          error: z.string().nullable(),
        })
        .strict(),
    ),
    assignableCount: nonNegativeInteger,
    blockedCount: nonNegativeInteger,
    assignmentCount: nonNegativeInteger,
  })
  .strict();

const bulkAssignmentCreationResponseSchema = z
  .object({
    assignments: z.array(
      z
        .object({
          student_id: z.uuid(),
          assignment_id: z.uuid(),
          session_number: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

const legacyReviewCancelResponseSchema = z
  .object({
    status: z.literal("cancelled"),
    queueDisposition: z.literal("pending"),
  })
  .strict();

export type AssignmentCapacityResponse = z.infer<
  typeof assignmentCapacityResponseSchema
>;
export type AssignmentCreationResponse = z.infer<
  typeof assignmentCreationResponseSchema
>;
export type AssignmentReplacementResponse = z.infer<
  typeof assignmentReplacementResponseSchema
>;
export type AssignmentEditDraftResponse = z.infer<
  typeof assignmentEditDraftResponseSchema
>;
export type BulkAssignmentPreviewResponse = z.infer<
  typeof bulkAssignmentPreviewResponseSchema
>;
export type BulkAssignmentCreationResponse = z.infer<
  typeof bulkAssignmentCreationResponseSchema
>;
export type LegacyReviewCancelResponse = z.infer<
  typeof legacyReviewCancelResponseSchema
>;

export function parseAssignmentCapacityResponse(
  value: unknown,
): AssignmentCapacityResponse {
  return assignmentCapacityResponseSchema.parse(value);
}

export function parseAssignmentCreationResponse(
  value: unknown,
): AssignmentCreationResponse {
  return assignmentCreationResponseSchema.parse(value);
}

export function parseAssignmentReplacementResponse(
  value: unknown,
): AssignmentReplacementResponse {
  return assignmentReplacementResponseSchema.parse(value);
}

export function parseAssignmentEditDraftResponse(
  value: unknown,
): AssignmentEditDraftResponse {
  return assignmentEditDraftResponseSchema.parse(value);
}

export function parseBulkAssignmentPreviewResponse(
  value: unknown,
): BulkAssignmentPreviewResponse {
  return bulkAssignmentPreviewResponseSchema.parse(value);
}

export function parseBulkAssignmentCreationResponse(
  value: unknown,
): BulkAssignmentCreationResponse {
  return bulkAssignmentCreationResponseSchema.parse(value);
}

export function parseLegacyReviewCancelResponse(
  value: unknown,
): LegacyReviewCancelResponse {
  return legacyReviewCancelResponseSchema.parse(value);
}
