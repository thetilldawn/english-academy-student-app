import { z } from "zod";

import { timingModes } from "@/lib/admin/assignment-settings";
import { readingCurriculumStages } from "@/lib/admin/reading-curriculum";

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

export const createVocabTimeTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    availableTime: clockTimeSchema,
    deadlineDayOffset: z.number().int().min(0).max(30),
    deadlineTime: clockTimeSchema,
    timingMode: z.enum(timingModes),
    totalSeconds: z.number().int().min(30).max(10800).nullable(),
    perQuestionSeconds: z.number().int().min(5).max(600).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const valid = value.timingMode === "none"
      ? value.totalSeconds === null && value.perQuestionSeconds === null
      : value.timingMode === "total"
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

export const answerSchema = z.object({
  questionId: z.uuid(),
  phase: z.enum(["initial", "retry"]),
  choiceIndex: z.number().int().min(0).max(3),
});

export const questionTimeoutSchema = z.object({
  questionId: z.uuid(),
  phase: z.enum(["initial", "retry"]),
});
