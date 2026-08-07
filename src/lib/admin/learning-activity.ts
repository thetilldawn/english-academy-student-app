import type { AssignmentHistorySummary } from "@/lib/admin/history";

export type LearningActivityBucket =
  | "open_without_deadline"
  | "open_with_deadline"
  | "in_progress"
  | "needs_attention"
  | "completed"
  | "archived";

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

export function learningActivityEffectiveAt(
  item: AssignmentHistorySummary,
) {
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
    return item.startedAt ?? item.activityAt;
  }
  return item.assignedAt ?? item.activityAt;
}

export function activityPassed(item: AssignmentHistorySummary) {
  if (item.status !== "completed") return false;
  if (item.finalScore === null) return item.passed === true;
  return item.finalScore >= item.passingScore;
}

export function activityNeedsRetry(item: AssignmentHistorySummary) {
  const retryStatus =
    item.status === "expired" ||
    (item.status === "completed" && !activityPassed(item));
  return (
    retryStatus &&
    (item.unresolvedWrongCount === null || item.unresolvedWrongCount > 0)
  );
}

export function learningActivityBucket(
  item: AssignmentHistorySummary,
): LearningActivityBucket {
  if (item.assignmentDeleted || item.status === "cancelled") {
    return "archived";
  }
  if (item.status === "not_started") {
    return item.availableUntil
      ? "open_with_deadline"
      : "open_without_deadline";
  }
  if (item.status === "in_progress") return "in_progress";
  if (
    item.status === "missed" ||
    activityNeedsRetry(item)
  ) {
    return "needs_attention";
  }
  return "completed";
}

const bucketOrder: Record<LearningActivityBucket, number> = {
  open_without_deadline: 0,
  open_with_deadline: 1,
  in_progress: 2,
  needs_attention: 3,
  completed: 4,
  archived: 5,
};

export function compareLearningActivities(
  left: AssignmentHistorySummary,
  right: AssignmentHistorySummary,
) {
  const leftBucket = learningActivityBucket(left);
  const rightBucket = learningActivityBucket(right);
  const bucketDifference = bucketOrder[leftBucket] - bucketOrder[rightBucket];
  if (bucketDifference !== 0) return bucketDifference;

  if (leftBucket === "open_without_deadline") {
    return timestamp(left.assignedAt) - timestamp(right.assignedAt);
  }
  if (leftBucket === "open_with_deadline") {
    return (
      timestamp(left.availableUntil, Number.MAX_SAFE_INTEGER) -
      timestamp(right.availableUntil, Number.MAX_SAFE_INTEGER)
    );
  }
  if (leftBucket === "in_progress") {
    return timestamp(left.startedAt) - timestamp(right.startedAt);
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

  const bucket = learningActivityBucket(item);
  if (
    filters.status === "open" &&
    !["open_without_deadline", "open_with_deadline", "in_progress"].includes(
      bucket,
    )
  ) {
    return false;
  }
  if (
    filters.status !== "all" &&
    filters.status !== "open" &&
    bucket !== filters.status
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
    missed: sorted.filter((item) => item.status === "missed"),
    failed: sorted.filter(
      (item) => activityNeedsRetry(item),
    ),
    dueSoon: sorted.filter(
      (item) => item.status === "not_started" && item.availableUntil !== null,
    ),
    noDeadline: sorted.filter(
      (item) => item.status === "not_started" && item.availableUntil === null,
    ),
  };
}
