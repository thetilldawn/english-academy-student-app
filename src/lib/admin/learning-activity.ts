import type { AssignmentHistorySummary } from "@/lib/admin/history";

export type LearningActivityBucket =
  | "open_without_deadline"
  | "open_with_deadline"
  | "in_progress"
  | "needs_attention"
  | "completed"
  | "archived";

export type LearningActivitySection =
  | "open"
  | "needs_attention"
  | "completed"
  | "archived";

export type LearningActivityOrderInput = {
  status: AssignmentHistorySummary["status"];
  phase?: AssignmentHistorySummary["phase"];
  assignedAt: string | null;
  availableUntil: string | null;
  startedAt: string | null;
  initialCompletedAt?: string | null;
  completedAt: string | null;
  missedAt: string | null;
  cancelledAt?: string | null;
  deadlineAt: string | null;
  activityAt: string;
  assignmentDeleted?: boolean;
  passed?: boolean | null;
  finalScore?: number | null;
  passingScore: number;
  unresolvedWrongCount?: number | null;
};

export type LearningHistoryPurposeFilter =
  | "all"
  | "regular"
  | "mixed"
  | "review";

export type LearningHistoryStatusFilter =
  | "all"
  | "open"
  | "needs_attention"
  | "completed"
  | "archived";

function timestamp(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function inProgressDeadline(item: LearningActivityOrderInput) {
  if (item.status !== "in_progress") return null;
  return item.phase === "review"
    ? item.availableUntil
    : item.deadlineAt ?? item.availableUntil;
}

function compareInProgressUrgency(
  left: LearningActivityOrderInput,
  right: LearningActivityOrderInput,
) {
  const leftInProgress = left.status === "in_progress";
  const rightInProgress = right.status === "in_progress";
  if (leftInProgress !== rightInProgress) {
    return leftInProgress ? -1 : 1;
  }
  if (!leftInProgress) return 0;

  const deadlineDifference =
    timestamp(inProgressDeadline(left), Number.MAX_SAFE_INTEGER) -
    timestamp(inProgressDeadline(right), Number.MAX_SAFE_INTEGER);
  return deadlineDifference;
}

export function learningActivityEffectiveAt(item: LearningActivityOrderInput) {
  if (item.status === "cancelled") {
    return item.cancelledAt ?? item.activityAt;
  }
  if (item.status === "missed") {
    return item.missedAt ?? item.availableUntil ?? item.activityAt;
  }
  if (item.status === "expired") {
    return item.deadlineAt ?? item.activityAt;
  }
  if (item.status === "completed") {
    return item.completedAt ?? item.activityAt;
  }
  if (item.status === "in_progress") {
    return item.phase === "review"
      ? item.initialCompletedAt ?? item.startedAt ?? item.activityAt
      : item.startedAt ?? item.activityAt;
  }
  return item.assignedAt ?? item.activityAt;
}

export function activityPassed(item: LearningActivityOrderInput) {
  if (item.status !== "completed") return false;
  if (item.finalScore == null) return item.passed === true;
  return item.finalScore >= item.passingScore;
}

export function activityNeedsRetry(item: LearningActivityOrderInput) {
  const retryStatus =
    item.status === "expired" ||
    (item.status === "completed" && !activityPassed(item));
  return (
    retryStatus &&
    (item.unresolvedWrongCount == null || item.unresolvedWrongCount > 0)
  );
}

export function learningActivityBucket(
  item: LearningActivityOrderInput,
): LearningActivityBucket {
  const section = learningActivitySection(item);
  if (section === "archived") return "archived";
  if (section === "needs_attention") return "needs_attention";
  if (section === "completed") return "completed";
  if (item.status === "not_started") {
    return item.availableUntil
      ? "open_with_deadline"
      : "open_without_deadline";
  }
  return "in_progress";
}

export function learningActivitySection(
  item: LearningActivityOrderInput,
): LearningActivitySection {
  if (item.assignmentDeleted || item.status === "cancelled") {
    return "archived";
  }
  if (
    item.status === "missed" ||
    item.status === "expired" ||
    (item.status === "in_progress" && item.phase === "review") ||
    (item.status === "completed" && !activityPassed(item))
  ) {
    return "needs_attention";
  }
  if (item.status === "completed") return "completed";
  return "open";
}

const sectionOrder: Record<LearningActivitySection, number> = {
  open: 0,
  needs_attention: 1,
  completed: 2,
  archived: 3,
};

export function compareLearningActivities(
  left: LearningActivityOrderInput,
  right: LearningActivityOrderInput,
) {
  const leftSection = learningActivitySection(left);
  const rightSection = learningActivitySection(right);
  const sectionDifference =
    sectionOrder[leftSection] - sectionOrder[rightSection];
  if (sectionDifference !== 0) return sectionDifference;

  const inProgressDifference = compareInProgressUrgency(left, right);
  if (inProgressDifference !== 0) return inProgressDifference;

  if (leftSection === "open") {
    const deadlinePresenceDifference =
      Number(left.availableUntil !== null) -
      Number(right.availableUntil !== null);
    if (deadlinePresenceDifference !== 0) {
      return deadlinePresenceDifference;
    }
    const deadlineDifference =
      timestamp(left.availableUntil, Number.MAX_SAFE_INTEGER) -
      timestamp(right.availableUntil, Number.MAX_SAFE_INTEGER);
    return deadlineDifference !== 0
      ? deadlineDifference
      : timestamp(right.assignedAt) - timestamp(left.assignedAt);
  }

  const leftFinishedAt = learningActivityEffectiveAt(left);
  const rightFinishedAt = learningActivityEffectiveAt(right);
  return timestamp(rightFinishedAt) - timestamp(leftFinishedAt);
}

export function sortLearningActivities(
  items: AssignmentHistorySummary[],
) {
  return items.toSorted(compareLearningActivities);
}

export function matchesLearningHistoryFilters(
  item: AssignmentHistorySummary,
  filters: {
    purpose: LearningHistoryPurposeFilter;
    status: LearningHistoryStatusFilter;
    since: number | null;
  },
) {
  if (
    filters.purpose !== "all" &&
    item.assignmentPurpose !== filters.purpose
  ) {
    return false;
  }

  const section = learningActivitySection(item);
  if (
    filters.status !== "all" &&
    section !== filters.status
  ) {
    return false;
  }

  return (
    filters.since === null ||
    timestamp(learningActivityEffectiveAt(item)) >= filters.since
  );
}

export function studentLearningActivityIndex(
  items: AssignmentHistorySummary[],
) {
  const index = new Map<string, AssignmentHistorySummary[]>();
  for (const item of items) {
    const current = index.get(item.studentId) ?? [];
    current.push(item);
    index.set(item.studentId, current);
  }
  for (const [studentId, activities] of index) {
    index.set(studentId, sortLearningActivities(activities));
  }
  return index;
}

export function overviewActivityGroups(items: AssignmentHistorySummary[]) {
  const sorted = sortLearningActivities(
    items.filter(
      (item) => !item.assignmentDeleted && !item.studentDeleted,
    ),
  );
  return {
    open: sorted.filter(
      (item) => learningActivitySection(item) === "open",
    ),
    needsAttention: sorted.filter(
      (item) => learningActivitySection(item) === "needs_attention",
    ),
    completed: sorted.filter(
      (item) => learningActivitySection(item) === "completed",
    ),
  };
}
