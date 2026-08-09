import type { AssignmentHistorySummary } from "@/lib/admin/history";

const UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const ATTEMPT_KEY = new RegExp(`^attempt\\.(${UUID})$`);
const ASSIGNMENT_KEY = new RegExp(`^assignment\\.(${UUID})\\.(${UUID})$`);
const BARE_ATTEMPT_KEY = new RegExp(`^(${UUID})$`);

export type ParsedHistoryEntryKey =
  | { kind: "attempt"; attemptId: string }
  | { kind: "assignment"; assignmentId: string; studentId: string };

export function parseHistoryEntryKey(
  entryKey: string,
): ParsedHistoryEntryKey | null {
  const attempt = ATTEMPT_KEY.exec(entryKey) ?? BARE_ATTEMPT_KEY.exec(entryKey);
  if (attempt?.[1]) {
    return { kind: "attempt", attemptId: attempt[1].toLowerCase() };
  }

  const assignment = ASSIGNMENT_KEY.exec(entryKey);
  if (assignment?.[1] && assignment[2]) {
    return {
      kind: "assignment",
      assignmentId: assignment[1].toLowerCase(),
      studentId: assignment[2].toLowerCase(),
    };
  }

  return null;
}

export function historyEntryKey(
  item: Pick<AssignmentHistorySummary, "attemptId" | "assignmentId" | "studentId">,
) {
  return item.attemptId
    ? `attempt.${item.attemptId}`
    : `assignment.${item.assignmentId}.${item.studentId}`;
}

export function historyDetailHref(
  item: Pick<AssignmentHistorySummary, "attemptId" | "assignmentId" | "studentId">,
) {
  return `/admin/results/${historyEntryKey(item)}`;
}
