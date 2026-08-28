import type { AssignmentDraftIssue } from "../domain/validation";

export type AssignmentEditFieldErrors = Partial<Record<
  | "dataset"
  | "range"
  | "questionCount"
  | "questionOrder"
  | "direction"
  | "passingScore"
  | "retryPassingScore"
  | "timing"
  | "availability"
  | "deadline",
  string
>>;

export function assignmentEditFieldKeyForPath(
  path: string,
): keyof AssignmentEditFieldErrors | null {
  if (path === "range.datasetId") return "dataset";
  if (path.startsWith("range.orderedUnitIds")) return "range";
  if (path === "questionCount") return "questionCount";
  if (path === "exam.questionOrderMode") return "questionOrder";
  if (path === "exam.directionRatio") return "direction";
  if (path === "exam.passingScore") return "passingScore";
  if (path === "exam.retryPassingScore") return "retryPassingScore";
  if (path.startsWith("exam.timing")) return "timing";
  if (path.startsWith("availability")) return "availability";
  if (path.startsWith("deadline")) return "deadline";
  return null;
}

export function assignmentEditFieldErrors(
  issues: readonly AssignmentDraftIssue[],
): AssignmentEditFieldErrors {
  const errors: AssignmentEditFieldErrors = {};
  for (const issue of issues) {
    const key = assignmentEditFieldKeyForPath(issue.path);
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
