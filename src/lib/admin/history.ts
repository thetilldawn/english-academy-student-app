export type AssignmentActivityStatus =
  | "not_started"
  | "cancelled"
  | "missed"
  | "in_progress"
  | "completed"
  | "expired";

export type AssignmentPurpose = "regular" | "review" | "mixed";

export type AssignmentHistorySource = {
  assignmentId: string;
  assignmentTitle: string;
  assignmentDeleted: boolean;
  assignmentStatus: "draft" | "active" | "closed";
  assignmentPurpose: AssignmentPurpose;
  studentId: string;
  studentName: string;
  studentDeleted: boolean;
  studentStatus: "active" | "blocked";
  schoolName: string | null;
  gradeLabel: string | null;
  datasetId: string;
  datasetTitle: string;
  unitIds: string[];
  unitLabels: string[];
  primaryUnitIds: string[];
  primaryUnitLabels: string[];
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  timingMode: TimingMode;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  questionOrderMode: QuestionOrderMode;
  availableFrom: string | null;
  availableUntil: string | null;
  assignedAt: string;
  missedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
};

export type AttemptHistorySource = {
  id: string;
  assignmentId: string;
  studentId: string;
  attemptNumber: number;
  status: Exclude<
    AssignmentActivityStatus,
    "not_started" | "cancelled" | "missed"
  >;
  phase: "initial" | "review" | "retry" | "completed";
  questionCount: number;
  timeLimitSeconds: number;
  passingScore: number;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  startedAt: string;
  initialCompletedAt?: string | null;
  retryStartedAt: string | null;
  deadlineAt: string;
  completedAt: string | null;
};

export type AssignmentHistorySummary = AssignmentHistorySource & {
  id: string;
  attemptId: string | null;
  attemptNumber: number | null;
  status: AssignmentActivityStatus;
  phase: AttemptHistorySource["phase"] | null;
  activityAt: string;
  initialCorrectCount: number | null;
  retryCorrectCount: number | null;
  unresolvedWrongCount: number | null;
  initialScore: number | null;
  finalScore: number | null;
  passed: boolean | null;
  startedAt: string | null;
  initialCompletedAt?: string | null;
  retryStartedAt: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
};

function pairKey(assignmentId: string, studentId: string) {
  return `${assignmentId}\u0000${studentId}`;
}

function unitRangeLabel(labels: string[]) {
  if (labels.length === 0) return "범위 정보 없음";
  if (labels.length === 1) return labels[0];
  return `${labels[0]}~${labels.at(-1)}`;
}

export function assignmentTypeLabel(
  assignmentPurpose: AssignmentPurpose,
) {
  if (assignmentPurpose === "review") return "오답 시험";
  if (assignmentPurpose === "mixed") return "틀린 단어 포함";
  return "단어 시험";
}

export function assignmentUnitRangeLabel(
  item: Pick<
    AssignmentHistorySource,
    "assignmentPurpose" | "primaryUnitLabels" | "unitLabels"
  >,
) {
  const labels =
    item.assignmentPurpose === "review"
      ? item.unitLabels
      : item.primaryUnitLabels.length > 0
        ? item.primaryUnitLabels
        : item.unitLabels;
  return unitRangeLabel(labels);
}

export function assignmentScopeLabel(
  item: Pick<
    AssignmentHistorySource,
    | "assignmentPurpose"
    | "primaryUnitLabels"
    | "unitLabels"
    | "questionCount"
  >,
) {
  if (item.assignmentPurpose === "review") {
    return `오답 시험 · ${item.questionCount}문항`;
  }

  const label = assignmentUnitRangeLabel(item);
  return item.assignmentPurpose === "mixed"
    ? `${label} · 오답 포함`
    : label;
}

export function assignmentDisplayTitle(
  item: Pick<
    AssignmentHistorySummary,
    "assignmentTitle" | "datasetTitle" | "primaryUnitLabels" | "unitLabels"
  >,
) {
  return assignmentDisplayTitleForUnits(
    item.assignmentTitle,
    [...item.unitLabels, ...item.primaryUnitLabels],
    item.datasetTitle,
  );
}

function stripDatasetTitlePrefix(
  assignmentTitle: string,
  datasetTitle?: string,
) {
  const title = assignmentTitle.trim();
  const dataset = datasetTitle?.trim();
  if (!dataset) return title;
  if (title === dataset) return "";
  if (!title.startsWith(dataset)) return title;

  const remainder = title.slice(dataset.length);
  const separator = remainder.match(/^\s*·\s*/u)?.[0];
  return separator ? remainder.slice(separator.length) : title;
}

export function assignmentDisplayTitleForUnits(
  assignmentTitle: string,
  unitLabels: string[],
  datasetTitle?: string,
) {
  const unitLabelSet = new Set(unitLabels);
  if (unitLabels.length > 0) {
    unitLabelSet.add(unitRangeLabel(unitLabels));
  }
  const titleParts = stripDatasetTitlePrefix(
    assignmentTitle,
    datasetTitle,
  )
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const filtered = titleParts.filter(
    (part) =>
      !unitLabelSet.has(part) &&
      part !== "오답 재시험" &&
      part !== "오답 시험" &&
      !/^\d+문항$/.test(part) &&
      !/^틀렸던 단어 \d+개 포함$/.test(part),
  );
  return filtered.join(" · ");
}

export function assignmentOrderLabel(
  _assignmentPurpose: AssignmentPurpose,
  questionOrderMode: QuestionOrderMode,
) {
  if (questionOrderMode === "random") return "무작위 순서";
  if (questionOrderMode === "descending") return "내림차순";
  return "오름차순";
}

export function buildAssignmentHistory(
  assignments: AssignmentHistorySource[],
  attempts: AttemptHistorySource[],
  now = Date.now(),
): AssignmentHistorySummary[] {
  const attemptsByAssignmentStudent = new Map<
    string,
    AttemptHistorySource[]
  >();

  for (const attempt of attempts) {
    const key = pairKey(attempt.assignmentId, attempt.studentId);
    const current = attemptsByAssignmentStudent.get(key) ?? [];
    current.push(attempt);
    attemptsByAssignmentStudent.set(key, current);
  }

  const history: AssignmentHistorySummary[] = [];
  for (const assignment of assignments) {
    const matchingAttempts =
      attemptsByAssignmentStudent.get(
        pairKey(assignment.assignmentId, assignment.studentId),
      ) ?? [];

    if (matchingAttempts.length === 0) {
      const availableUntil = assignment.availableUntil
        ? Date.parse(assignment.availableUntil)
        : Number.NaN;
      const missed =
        assignment.missedAt !== null ||
        (!Number.isNaN(availableUntil) && availableUntil <= now);
      const cancelled = assignment.cancelledAt !== null;
      history.push({
        ...assignment,
        id: `assignment:${assignment.assignmentId}:${assignment.studentId}`,
        attemptId: null,
        attemptNumber: null,
        status: cancelled
          ? "cancelled"
          : missed
            ? "missed"
            : "not_started",
        phase: null,
        activityAt: cancelled
          ? (assignment.cancelledAt ?? assignment.assignedAt)
          : missed
            ? (assignment.missedAt ??
              assignment.availableUntil ??
              assignment.assignedAt)
            : assignment.assignedAt,
        initialCorrectCount: null,
        retryCorrectCount: null,
        unresolvedWrongCount: null,
        initialScore: null,
        finalScore: null,
        passed: null,
        startedAt: null,
        initialCompletedAt: null,
        retryStartedAt: null,
        deadlineAt: null,
        completedAt: null,
      });
      continue;
    }

    for (const attempt of matchingAttempts) {
      const deadline = Date.parse(attempt.deadlineAt);
      const effectiveStatus =
        attempt.status === "in_progress" &&
        attempt.phase !== "review" &&
        !Number.isNaN(deadline) &&
        deadline <= now
          ? "expired"
          : attempt.status;
      history.push({
        ...assignment,
        id: attempt.id,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: effectiveStatus,
        phase: attempt.phase,
        activityAt: attempt.startedAt,
        questionCount: attempt.questionCount,
        timeLimitSeconds: attempt.timeLimitSeconds,
        passingScore: attempt.passingScore,
        initialCorrectCount: attempt.initialCorrectCount,
        retryCorrectCount: attempt.retryCorrectCount,
        unresolvedWrongCount: attempt.unresolvedWrongCount,
        initialScore: attempt.initialScore,
        finalScore: attempt.finalScore,
        passed: attempt.passed,
        startedAt: attempt.startedAt,
        initialCompletedAt: attempt.initialCompletedAt ?? null,
        retryStartedAt: attempt.retryStartedAt,
        deadlineAt: attempt.deadlineAt,
        completedAt: attempt.completedAt,
      });
    }
  }

  return history.toSorted(
    (left, right) =>
      Date.parse(right.activityAt) - Date.parse(left.activityAt),
  );
}

export function projectCurrentAssignmentHistory(
  items: AssignmentHistorySummary[],
) {
  const latestByRecipient = new Map<string, AssignmentHistorySummary>();
  for (const item of items) {
    const key = pairKey(item.assignmentId, item.studentId);
    const current = latestByRecipient.get(key);
    if (!current) {
      latestByRecipient.set(key, item);
      continue;
    }
    const attemptDifference =
      (item.attemptNumber ?? -1) - (current.attemptNumber ?? -1);
    const activityDifference =
      Date.parse(item.activityAt) - Date.parse(current.activityAt);
    if (
      attemptDifference > 0 ||
      (attemptDifference === 0 && activityDifference > 0) ||
      (attemptDifference === 0 &&
        activityDifference === 0 &&
        item.id.localeCompare(current.id) > 0)
    ) {
      latestByRecipient.set(key, item);
    }
  }
  return [...latestByRecipient.values()];
}
import type {
  QuestionOrderMode,
  TimingMode,
} from "@/lib/admin/assignment-settings";
