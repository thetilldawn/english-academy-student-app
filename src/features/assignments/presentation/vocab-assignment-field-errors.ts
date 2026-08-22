import type { AssignmentDraftIssue } from "../domain/validation";

export type VocabAssignmentFieldKey =
  | "dataset"
  | "range"
  | "distribution"
  | "splitBasis"
  | "unitAllocationMode"
  | "unitsPerSession"
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
  | `session-${number}-deadline`
  | `weekday-${number}-units`;

export function hasVocabAssignmentFieldError(
  errors: Partial<Record<VocabAssignmentFieldKey, string>>,
  keys: readonly VocabAssignmentFieldKey[],
) {
  return keys.some((key) => Boolean(errors[key]));
}

export function hasVocabScheduleFieldError(
  errors: Partial<Record<VocabAssignmentFieldKey, string>>,
) {
  return hasVocabAssignmentFieldError(errors, [
    "startDate",
    "weekdays",
    "availableTime",
    "deadlineOffset",
    "deadlineTime",
    "unitAllocationMode",
    "unitsPerSession",
    "overflowPolicy",
    "preview",
  ]) || Object.keys(errors).some(
    (key) => key.startsWith("session-") || key.startsWith("weekday-"),
  );
}

const fieldOrder: readonly VocabAssignmentFieldKey[] = [
  "dataset",
  "range",
  "distribution",
  "splitBasis",
  "questionCount",
  "selectionMode",
  "direction",
  "questionOrder",
  "passingScore",
  "timing",
  "startDate",
  "weekdays",
  "unitAllocationMode",
  "overflowPolicy",
  "unitsPerSession",
  "availableTime",
  "deadlineOffset",
  "deadlineTime",
  "preview",
  "students",
];

function fieldRank(key: VocabAssignmentFieldKey) {
  const staticIndex = fieldOrder.indexOf(key);
  if (staticIndex >= 0) {
    return key === "preview" || key === "students"
      ? 10_000 + staticIndex
      : staticIndex;
  }
  const session = key.match(/^session-(\d+)-(available|deadline)$/);
  if (session) {
    return 100 + Number(session[1]) * 2 + (session[2] === "deadline" ? 1 : 0);
  }
  const weekday = key.match(/^weekday-(\d+)-units$/);
  return weekday
    ? fieldOrder.indexOf("unitsPerSession") + Number(weekday[1]) / 100
    : 20_000;
}

export function vocabAssignmentFieldKeyForIssue(
  issue: AssignmentDraftIssue,
): VocabAssignmentFieldKey {
  const path = issue.path;
  if (path === "studentIds") return "students";
  if (path === "commonPlan" || path === "commonPlan.datasetId") {
    return "dataset";
  }
  if (/commonPlan\.sessions\.\d+\.unitIds/.test(path)) return "range";
  if (path === "commonPlan.splitBasis") return "splitBasis";
  if (path === "commonPlan.unitAllocationMode") return "unitAllocationMode";
  if (path === "commonPlan.unitsPerSession") return "unitsPerSession";
  if (path === "commonPlan.rangeUnitCounts") return "unitAllocationMode";
  const weekdayUnits = path.match(
    /^commonPlan\.weekdayUnitsPerSession\.(\d+)$/,
  );
  if (weekdayUnits) return `weekday-${Number(weekdayUnits[1])}-units`;
  if (path === "commonPlan.questionCount") return "questionCount";
  if (path === "commonPlan.overflowPolicy") return "overflowPolicy";
  if (
    path === "commonPlan.extraDatePolicy" ||
    path === "commonPlan.selectedDateCount"
  ) return "weekdays";
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
  const firstFieldKey = (Object.keys(errors) as VocabAssignmentFieldKey[])
    .toSorted((left, right) => fieldRank(left) - fieldRank(right))[0] ?? null;
  return {
    errors,
    firstFieldKey,
    blockerReason: firstFieldKey ? errors[firstFieldKey] ?? null : null,
  };
}
