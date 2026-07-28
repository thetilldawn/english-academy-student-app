import { z } from "zod";

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
  currentVocabBook: z.string().trim().max(160).default(""),
  note: z.string().trim().max(2000).default(""),
});

export const assignmentSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    datasetId: z.uuid(),
    rangeStart: z.coerce.number().int().min(1),
    rangeEnd: z.coerce.number().int().min(1),
    questionCount: z.coerce.number().int().min(4).max(500),
    timeLimitSeconds: z.coerce.number().int().min(30).max(10800),
    passingScore: z.coerce.number().int().min(0).max(100),
    retakeAllowed: z.boolean().default(false),
    studentIds: z.array(z.uuid()).min(1),
  })
  .refine((value) => value.rangeEnd >= value.rangeStart, {
    message: "끝 번호는 시작 번호보다 작을 수 없습니다.",
    path: ["rangeEnd"],
  })
  .refine(
    (value) =>
      value.questionCount <= value.rangeEnd - value.rangeStart + 1,
    {
      message: "문항 수가 선택 범위보다 많습니다.",
      path: ["questionCount"],
    },
  );

export const answerSchema = z.object({
  questionId: z.uuid(),
  phase: z.enum(["initial", "retry"]),
  choiceIndex: z.number().int().min(0).max(3),
});
