import { z } from "zod";

export const assignmentCountBreakdownSchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  outsideCandidateListCount: z.number().int().nonnegative(),
  activeReviewExcludedCount: z.number().int().nonnegative(),
  directionExcludedCount: z.number().int().nonnegative(),
  choiceExcludedCount: z.number().int().nonnegative(),
  allocationExcludedCount: z.number().int().nonnegative(),
  availableCount: z.number().int().nonnegative(),
}).strict().refine(value => value.sourceCount === value.outsideCandidateListCount +
  value.activeReviewExcludedCount + value.directionExcludedCount + value.choiceExcludedCount +
  value.allocationExcludedCount + value.availableCount, "출제 수량의 단계별 합계가 맞지 않습니다.");

export type AssignmentCountBreakdown = z.infer<typeof assignmentCountBreakdownSchema>;


// Display diagnostics never change target selection or submission validity.
export function checkedAssignmentCountBreakdown(
  input: Omit<AssignmentCountBreakdown, "outsideCandidateListCount" | "sourceCount"> & {
    sourceCount: number | null;
    candidateCount: number;
  },
): AssignmentCountBreakdown | null {
  if (input.sourceCount === null) return null;
  const { candidateCount, ...counts } = input;
  const parsed = assignmentCountBreakdownSchema.safeParse({
    ...counts,
    outsideCandidateListCount: input.sourceCount - candidateCount,
  });
  return parsed.success ? parsed.data : null;
}
