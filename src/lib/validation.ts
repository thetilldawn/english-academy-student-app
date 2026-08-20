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

const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시각을 확인해 주세요.");

const reservedVocabTimeTemplateNames = new Set([
  "수업 후",
  "저녁",
  "당일 마감",
]);

export const createVocabTimeTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(30).refine(
      (name) => !reservedVocabTimeTemplateNames.has(name),
      "기본 시간 버튼과 다른 이름을 사용해 주세요.",
    ),
    availableTime: clockTimeSchema,
    deadlineDayOffset: z.number().int().min(0).max(30),
    deadlineTime: clockTimeSchema,
    timingMode: z.enum(timingModes),
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
        message: "제한시간 방식을 확인해 주세요.",
      });
    }
  });

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

const bulkCollisionDecisionSchema = z
  .object({
    collisionId: z.string().trim().min(1).max(240),
    mode: z.enum(["skip", "move", "allow"]),
    movedAvailableFrom: z.iso.datetime({ offset: true }).nullable(),
    movedAvailableUntil: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "move") {
      if (
        !value.movedAvailableFrom ||
        !value.movedAvailableUntil ||
        Date.parse(value.movedAvailableUntil) <=
          Date.parse(value.movedAvailableFrom)
      ) {
        context.addIssue({
          code: "custom",
          path: ["movedAvailableUntil"],
          message: "이동할 시험의 공개·마감 시각을 확인해 주세요.",
        });
      }
    } else if (value.movedAvailableFrom || value.movedAvailableUntil) {
      context.addIssue({
        code: "custom",
        path: ["movedAvailableFrom"],
        message: "이동을 선택했을 때만 이동 시각을 보낼 수 있습니다.",
      });
    }
  });

const bulkCommonPlanSchema = z
  .object({
    datasetId: z.uuid(),
    distribution: z.enum(["split", "repeat"]),
    targetWordsPerSession: z.number().int().min(1).max(500),
    sessions: z
      .array(
        z
          .object({
            unitIds: z.array(z.uuid()).min(1).max(500),
            availableFrom: z.iso.datetime({ offset: true }),
            availableUntil: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    collisionDecisions: z.array(bulkCollisionDecisionSchema).max(210),
  })
  .strict();

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
  commonPlan: bulkCommonPlanSchema.optional(),
} as const;

function validateBulkAssignmentSelection(
  value: {
    studentIds: string[];
    reviewLevels: (1 | 2)[];
    firstAvailableFrom: string;
    firstAvailableUntil: string | null;
    sessionCount: number;
    commonPlan?: z.infer<typeof bulkCommonPlanSchema>;
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
  if (value.commonPlan) {
    if (value.commonPlan.sessions.length !== value.sessionCount) {
      context.addIssue({
        code: "custom",
        path: ["commonPlan", "sessions"],
        message: "공통 배정 회차와 시험 횟수가 일치하지 않습니다.",
      });
    }
    if (value.commonPlan.sessions.length === 0) return;
    if (new Set(value.commonPlan.collisionDecisions.map((item) => item.collisionId)).size !== value.commonPlan.collisionDecisions.length) {
      context.addIssue({
        code: "custom",
        path: ["commonPlan", "collisionDecisions"],
        message: "같은 겹침 결정을 두 번 보낼 수 없습니다.",
      });
    }
    let previousStart = Number.NEGATIVE_INFINITY;
    value.commonPlan.sessions.forEach((session, index) => {
      if (new Set(session.unitIds).size !== session.unitIds.length) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "unitIds"],
          message: "같은 DAY를 한 회차에 두 번 넣을 수 없습니다.",
        });
      }
      if (Date.parse(session.availableUntil) <= Date.parse(session.availableFrom)) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableUntil"],
          message: "회차 마감은 공개 시작보다 뒤여야 합니다.",
        });
      }
      if (Date.parse(session.availableFrom) <= previousStart) {
        context.addIssue({
          code: "custom",
          path: ["commonPlan", "sessions", index, "availableFrom"],
          message: "회차 공개 시각은 앞 회차보다 뒤여야 합니다.",
        });
      }
      previousStart = Date.parse(session.availableFrom);
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
