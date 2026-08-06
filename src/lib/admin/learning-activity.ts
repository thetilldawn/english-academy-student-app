import type { AssignmentHistorySummary } from "@/lib/admin/history";

export type LearningActivityBucket =
  | "open_without_deadline"
  | "open_with_deadline"
  | "in_progress"
  | "needs_attention"
  | "completed"
  | "archived";

function timestamp(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function activityPassed(item: AssignmentHistorySummary) {
  if (item.status !== "completed") return false;
  if (item.finalScore === null) return item.passed === true;
  return item.finalScore >= item.passingScore;
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
    item.status === "expired" ||
    (item.status === "completed" && !activityPassed(item))
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

  const leftFinishedAt =
    left.completedAt ?? left.cancelledAt ?? left.missedAt ?? left.activityAt;
  const rightFinishedAt =
    right.completedAt ?? right.cancelledAt ?? right.missedAt ?? right.activityAt;
  return timestamp(rightFinishedAt) - timestamp(leftFinishedAt);
}

export function sortLearningActivities(
  items: AssignmentHistorySummary[],
) {
  return items.toSorted(compareLearningActivities);
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
  const sorted = sortLearningActivities(items);
  return {
    missed: sorted.filter((item) => item.status === "missed"),
    failed: sorted.filter(
      (item) => item.status === "expired" ||
        (item.status === "completed" && !activityPassed(item)),
    ),
    dueSoon: sorted.filter(
      (item) => item.status === "not_started" && item.availableUntil !== null,
    ),
    noDeadline: sorted.filter(
      (item) => item.status === "not_started" && item.availableUntil === null,
    ),
  };
}
