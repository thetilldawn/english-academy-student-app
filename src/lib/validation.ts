import { z } from "zod";

import {
  questionOrderModes,
  timingModes,
} from "@/lib/admin/assignment-settings";

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

export const queueWrongWordsSchema = z
  .object({
    questionIds: z.array(z.uuid()).min(1).max(400),
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

export const mixedAssignmentSchema = z
  .object({
    studentId: z.uuid(),
    datasetId: z.uuid(),
    primaryUnitIds: z.array(z.uuid()).min(1).max(500),
    reviewLevels: z.array(mixedReviewLevelSchema).min(1).max(2),
    reviewLimit: z.number().int().min(1).max(400),
    totalQuestionCount: z.number().int().min(4).max(500),
    title: z.string().trim().max(160).default(""),
    englishToKoreanRatio: z.union([
      z.literal(0),
      z.literal(50),
      z.literal(100),
    ]),
    timeLimitSeconds: z.number().int().min(30).max(10800),
    passingScore: z.number().int().min(0).max(100),
    questionOrderMode: z.enum(questionOrderModes).default("random"),
    availableUntil: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .and(timingSettingsSchema)
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

export type MixedAssignmentInput = z.infer<
  typeof mixedAssignmentSchema
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
