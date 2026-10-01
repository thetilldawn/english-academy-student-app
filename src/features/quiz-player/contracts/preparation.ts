import { z } from "zod";
import { attemptSchema } from "../api/quiz-attempt";

// A preparation has no exam timestamps: it is not an attempt yet.
export const preparedQuizSchema = attemptSchema.omit({
  startedAt: true, deadlineAt: true, timerDeadlineAt: true, status: true,
}).extend({ kind: z.enum(["initial", "retry", "practice"]) });
export type PreparedQuiz = z.infer<typeof preparedQuizSchema>;
export const readyQuizSchema = z.object({
  completionConfirmed: z.boolean().optional(),
  id: z.string().min(1),
  phase: z.enum(["initial", "review", "retry", "completed"]),
  status: z.enum(["in_progress", "completed", "expired"]),
  startedAt: z.string().min(1), deadlineAt: z.string().min(1), timerDeadlineAt: z.string().min(1),
  currentQuestionId: z.string().nullable(), questionIds: z.array(z.string()).optional(),
  priorWrongLevels: z.array(z.union([z.literal(0),z.literal(1),z.literal(2)])).optional(),
  timerRemainingMilliseconds: z.number().finite().nonnegative(),
});
export type ReadyQuiz = z.infer<typeof readyQuizSchema>;

