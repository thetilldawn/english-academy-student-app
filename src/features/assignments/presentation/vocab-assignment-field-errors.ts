import type { AssignmentDraftIssue } from "../domain/validation";

export type VocabAssignmentFieldKey =
  | "dataset"
  | "range"
  | "distribution"
  | "questionCount"
  | "overflowPolicy"
  | "selectionMode"
  | "startDate"
  | "weekdays"
  | "availableTime"
  | "deadlineOffset"
  | "deadlineTime"
  | "direction"
  | "questionOrder"
  | "passingScore"
  | "timing"
  | "students"
  | "preview"
  | `session-${number}-available`
  | `session-${number}-deadline`;

export function vocabAssignmentFieldKeyForIssue(
  issue: AssignmentDraftIssue,
): VocabAssignmentFieldKey {
  const path = issue.path;
  if (path === "studentIds") return "students";
  if (path === "commonPlan" || path === "commonPlan.datasetId") {
    return "dataset";
  }
  if (/commonPlan\.sessions\.\d+\.unitIds/.test(path)) return "range";
  if (path === "commonPlan.questionCount") return "questionCount";
  if (path === "commonPlan.overflowPolicy") return "overflowPolicy";
  if (path === "commonPlan.selectionMode") return "selectionMode";
  if (path === "commonPlan.schedule.startDate") return "startDate";
  if (path === "commonPlan.schedule.availableTime") return "availableTime";
  if (path === "commonPlan.schedule.deadlineDayOffset") {
    return "deadlineOffset";
  }
  if (path === "commonPlan.schedule.deadlineTime") return "deadlineTime";
  if (path === "commonPlan.sessions" || path === "range.sessionCount") {
    return "weekdays";
  }
  const sessionMatch = path.match(
    /commonPlan\.sessions\.(\d+)\.(availableLocalDateTime|deadlineLocalDateTime)/,
  );
  if (sessionMatch) {
    const sessionNumber = Number(sessionMatch[1]) + 1;
    return sessionMatch[2] === "availableLocalDateTime"
      ? `session-${sessionNumber}-available`
      : `session-${sessionNumber}-deadline`;
  }
  if (path === "exam.directionRatio") return "direction";
  if (path === "exam.questionOrderMode") return "questionOrder";
  if (path === "exam.passingScore") return "passingScore";
  if (path.startsWith("exam.timing")) return "timing";
  return "preview";
}

export function buildVocabAssignmentFieldErrors(
  issues: readonly AssignmentDraftIssue[],
) {
  const errors: Partial<Record<VocabAssignmentFieldKey, string>> = {};
  for (const issue of issues) {
    const key = vocabAssignmentFieldKeyForIssue(issue);
    errors[key] ??= issue.message;
  }
  return {
    errors,
    firstFieldKey: issues[0]
      ? vocabAssignmentFieldKeyForIssue(issues[0])
      : null,
    blockerReason: issues[0]?.message ?? null,
  };
}
