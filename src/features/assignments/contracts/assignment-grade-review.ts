import { z } from "zod";

export const assignmentGradeReviewSchema = z.object({
  audienceMode: z.enum(["single", "bulk"]),
  datasetId: z.uuid(),
  datasetGrade: z.string().nullable(),
  studentIds: z.array(z.uuid()).max(210),
  mismatches: z.array(z.object({
    studentId: z.uuid(), displayName: z.string(), gradeLabel: z.string().nullable(),
  }).strict()).max(210),
  unknownStudentIds: z.array(z.uuid()).max(210),
  token: z.string().regex(/^[0-9a-f]{64}$/),
}).strict().superRefine((review, ctx) => {
  const ids = new Set(review.studentIds);
  const mismatchIds = review.mismatches.map(s => s.studentId);
  const compared = [...mismatchIds, ...review.unknownStudentIds];
  if (ids.size !== review.studentIds.length || new Set(compared).size !== compared.length ||
      compared.some(id => !ids.has(id))) {
    ctx.addIssue({ code: "custom", message: "학년 확인 대상이 배정 대상과 맞지 않습니다." });
  }
});

export type AssignmentGradeReview = z.infer<typeof assignmentGradeReviewSchema>;
