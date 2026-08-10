import { z } from "zod";

import {
  questionOrderModes,
  timingModes,
} from "@/lib/admin/assignment-settings";
import { bulkAssignmentRangeModes } from "@/lib/admin/bulk-assignment-range";
import { readingCurriculumStages } from "@/lib/admin/reading-curriculum";

const timingSettingsSchema = z
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
    if (
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
        message: "시간 제한 방식과 문제당 시간을 확인해주세요.",
      });
    }
  });

export const adminLoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});

export const studentCodeLoginSchema = z.object({
  code: z
    .string()
    .min(12)
    .max(32)
    .refine((value) => {
      const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return (
        normalized.length === 12 &&
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/.test(normalized)
      );
    }),
});

export const createStudentSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  schoolName: z.string().trim().max(120).default(""),
  gradeLabel: z.string().trim().max(40).default(""),
  currentVocabDatasetId: z
    .union([z.uuid(), z.literal(""), z.null()])
    .optional()
    .transform((value) => value || null),
  note: z.string().trim().max(2000).default(""),
});

export const updateStudentVocabSchema = z.object({
  currentVocabDatasetId: z
    .union([z.uuid(), z.literal(""), z.null()])
    .transform((value) => value || null),
});

export const updateStudentProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    schoolName: z.string().trim().max(120),
    gradeLabel: z.string().trim().max(40),
  })
  .strict();

export const queueWrongWordsSchema = z
  .object({
    questionIds: z.array(z.uuid()).min(1).max(500),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.questionIds).size === value.questionIds.length,
    {
      message: "같은 오답 단어를 두 번 선택할 수 없습니다.",
      path: ["questionIds"],
    },
  );

export const createWrongWordWorksheetRequestSchema = z
  .object({
    questionIds: z.array(z.uuid()).min(1).max(50),
    curriculumStage: z.enum(readingCurriculumStages),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.questionIds).size === value.questionIds.length,
    {
      message: "같은 오답 단어를 두 번 선택할 수 없습니다.",
      path: ["questionIds"],
    },
  );

export const createReviewAssignmentDraftSchema =
  queueWrongWordsSchema;

export const assignmentSchema = z
  .object({
    title: z.string().trim().max(160).default(""),
    datasetId: z.uuid(),
    unitIds: z.array(z.uuid()).min(1),
    questionCount: z.coerce.number().int().min(4).max(500),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    timeLimitSeconds: z.coerce.number().int().min(30).max(10800),
    passingScore: z.coerce.number().int().min(0).max(100),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    availableUntil: z
      .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
    studentIds: z.array(z.uuid()).min(1),
  })
  .and(timingSettingsSchema)
  .refine(
    (value) => new Set(value.unitIds).size === value.unitIds.length,
    {
      message: "같은 DAY를 두 번 선택할 수 없습니다.",
      path: ["unitIds"],
    },
  );

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
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    availableUntil: z
      .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
      .optional()
      .transform((value) => value || null),
  })
  .strict()
  .and(timingSettingsSchema);

const mixedReviewLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
]);

const reviewScopeSchema = z.enum(["dataset", "selection"]);

const bulkAssignmentSelectionFields = {
  studentIds: z.array(z.uuid()).min(1).max(30),
  rangeMode: z.enum(bulkAssignmentRangeModes).default("previous_span"),
  unitsPerSession: z.number().int().min(1).max(30).default(1),
  sessionCount: z.number().int().min(1).max(7).default(1),
  firstAvailableFrom: z.iso.datetime({ offset: true }),
  dayInterval: z.number().int().min(1).max(30).default(1),
  firstAvailableUntil: z.iso.datetime({ offset: true }).nullable(),
  includePendingReview: z.boolean(),
  reviewLevels: z.array(mixedReviewLevelSchema).min(1).max(2),
  englishToKoreanRatio: z.union([
    z.literal(0),
    z.literal(50),
    z.literal(100),
  ]),
} as const;

function validateBulkAssignmentSelection(
  value: {
    studentIds: string[];
    reviewLevels: (1 | 2)[];
    firstAvailableFrom: string;
    firstAvailableUntil: string | null;
  },
  context: z.RefinementCtx,
) {
  if (new Set(value.studentIds).size !== value.studentIds.length) {
    context.addIssue({
      code: "custom",
      path: ["studentIds"],
      message: "같은 학생을 두 번 선택할 수 없습니다.",
    });
  }
  if (new Set(value.reviewLevels).size !== value.reviewLevels.length) {
    context.addIssue({
      code: "custom",
      path: ["reviewLevels"],
      message: "같은 오답 단계를 두 번 선택할 수 없습니다.",
    });
  }
  if (
    value.firstAvailableUntil &&
    Date.parse(value.firstAvailableUntil) <= Date.parse(value.firstAvailableFrom)
  ) {
    context.addIssue({
      code: "custom",
      path: ["firstAvailableUntil"],
      message: "첫 시험 마감은 첫 배정 시간보다 뒤로 정해 주세요.",
    });
  }
}

export const bulkAssignmentPreviewSchema = z
  .object(bulkAssignmentSelectionFields)
  .strict()
  .superRefine(validateBulkAssignmentSelection);

export const bulkAssignmentSchema = z
  .object({
    ...bulkAssignmentSelectionFields,
    idempotencyKey: z.uuid(),
    timeLimitSeconds: z.number().int().min(30).max(10800),
    passingScore: z.number().int().min(0).max(100),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    timingMode: z.enum(timingModes),
    questionTimeLimitSeconds: z
      .number()
      .int()
      .min(5)
      .max(600)
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    validateBulkAssignmentSelection(value, context);
    if (
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

const mixedAssignmentSelectionSchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    reviewLevels: z.array(mixedReviewLevelSchema).min(1).max(2),
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
        message: "같은 DAY를 두 번 선택할 수 없습니다.",
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

export const mixedAssignmentPreviewSchema =
  mixedAssignmentSelectionSchema;

export const assignmentCapacitySchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    includePendingReview: z.boolean(),
    reviewLevels: z.array(mixedReviewLevelSchema).max(2),
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
        message: "같은 DAY를 두 번 선택할 수 없습니다.",
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
    reviewLevels: z.array(mixedReviewLevelSchema).max(2),
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
    questionOrderMode: z.enum(questionOrderModes),
    availableUntil: z.iso.datetime({ offset: true }).nullable(),
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
        message: "같은 DAY를 두 번 선택할 수 없습니다.",
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

export const mixedAssignmentSchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    reviewLevels: z.array(mixedReviewLevelSchema).min(1).max(2),
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
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.primaryUnitIds).size !==
      value.primaryUnitIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryUnitIds"],
        message: "같은 DAY를 두 번 선택할 수 없습니다.",
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
    if (
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
        message: "시간 제한 방식과 문제당 시간을 확인해주세요.",
      });
    }
  });

export type MixedAssignmentInput = z.infer<
  typeof mixedAssignmentSchema
>;

export type AssignmentInput = z.infer<typeof assignmentSchema>;

export type AssignmentReplacementInput = z.infer<
  typeof assignmentReplacementSchema
>;

export type MixedAssignmentPreviewInput = z.infer<
  typeof mixedAssignmentPreviewSchema
>;

export type AssignmentCapacityInput = z.infer<
  typeof assignmentCapacitySchema
>;

export type BulkAssignmentPreviewInput = z.infer<
  typeof bulkAssignmentPreviewSchema
>;

export type BulkAssignmentInput = z.infer<
  typeof bulkAssignmentSchema
>;

export const answerSchema = z.object({
  questionId: z.uuid(),
  phase: z.enum(["initial", "retry"]),
  choiceIndex: z.number().int().min(0).max(3),
});

export const questionTimeoutSchema = z.object({
  questionId: z.uuid(),
  phase: z.enum(["initial", "retry"]),
});
