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
  status: AssignmentHistorySummary["status"] | null;
  phase?: AssignmentHistorySummary["phase"];
  assignedAt: string | null;
  availableUntil: string | null;
  startedAt: string | null;
  initialCompletedAt?: string | null;
  retryStartedAt?: string | null;
  completedAt: string | null;
  missedAt: string | null;
  cancelledAt?: string | null;
  deadlineAt: string | null;
  activityAt: string;
  assignmentDeleted?: boolean;
  passed?: boolean | null;
  initialScore?: number | null;
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

export type LearningActivityKind =
  | "not_started"
  | "initial_in_progress"
  | "review_pending"
  | "retry_in_progress"
  | "missed"
  | "expired"
  | "failed"
  | "completed_first_try"
  | "completed_after_retry"
  | "cancelled";

export type LearningActivityOutcome =
  | "not_started"
  | "in_progress"
  | "failed"
  | "retried"
  | "missed"
  | "completed"
  | "cancelled";

export type LearningActivityState = {
  effectiveAt: string;
  kind: LearningActivityKind;
  needsRetry: boolean;
  outcome: LearningActivityOutcome;
  passed: boolean;
  section: LearningActivitySection;
  statusAt: string | null;
  urgencyDeadline: string | null;
};

function timestamp(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function completedPassed(item: LearningActivityOrderInput) {
  const resolvedScore = item.finalScore ?? item.initialScore;
  if (resolvedScore != null) return resolvedScore >= item.passingScore;
  return item.passed === true;
}

function deriveKind(item: LearningActivityOrderInput): LearningActivityKind {
  if (item.status === null || item.status === "not_started") {
    return "not_started";
  }
  if (item.status === "cancelled") return "cancelled";
  if (item.status === "missed") return "missed";
  if (item.status === "expired") return "expired";
  if (item.status === "in_progress") {
    if (item.phase === "review") return "review_pending";
    if (item.phase === "retry" || item.retryStartedAt) {
      return "retry_in_progress";
    }
    return "initial_in_progress";
  }
  if (!completedPassed(item)) return "failed";
  return item.retryStartedAt
    ? "completed_after_retry"
    : "completed_first_try";
}

function kindOutcome(kind: LearningActivityKind): LearningActivityOutcome {
  if (kind === "not_started") return "not_started";
  if (kind === "initial_in_progress") return "in_progress";
  if (kind === "retry_in_progress" || kind === "completed_after_retry") {
    return "retried";
  }
  if (kind === "missed") return "missed";
  if (kind === "completed_first_try") return "completed";
  if (kind === "cancelled") return "cancelled";
  return "failed";
}

function kindStatusAt(
  kind: LearningActivityKind,
  item: LearningActivityOrderInput,
) {
  if (kind === "not_started") return null;
  if (kind === "cancelled") return item.cancelledAt ?? item.activityAt;
  if (kind === "missed") {
    return item.missedAt ?? item.availableUntil ?? item.activityAt;
  }
  if (kind === "expired") return item.deadlineAt ?? item.activityAt;
  if (kind === "review_pending") {
    return item.initialCompletedAt ?? item.startedAt ?? item.activityAt;
  }
  if (kind === "retry_in_progress") {
    return item.retryStartedAt ?? item.startedAt ?? item.activityAt;
  }
  if (kind === "initial_in_progress") {
    return item.startedAt ?? item.activityAt;
  }
  return item.completedAt ?? item.activityAt;
}

export function deriveLearningActivityState(
  item: LearningActivityOrderInput,
): LearningActivityState {
  const kind = deriveKind(item);
  const passed =
    kind === "completed_first_try" || kind === "completed_after_retry";
  const archived = item.assignmentDeleted || kind === "cancelled";
  const section: LearningActivitySection = archived
    ? "archived"
    : kind === "missed" ||
        kind === "expired" ||
        kind === "review_pending" ||
        kind === "failed"
      ? "needs_attention"
      : passed
        ? "completed"
        : "open";
  const statusAt = kindStatusAt(kind, item);
  const effectiveAt =
    kind === "not_started"
      ? item.assignedAt ?? item.activityAt
      : statusAt ?? item.activityAt;
  const retryEligible = kind === "expired" || kind === "failed";

  return {
    effectiveAt,
    kind,
    needsRetry:
      retryEligible &&
      (item.unresolvedWrongCount == null || item.unresolvedWrongCount > 0),
    outcome: kindOutcome(kind),
    passed,
    section,
    statusAt,
    urgencyDeadline:
      kind === "review_pending"
        ? item.availableUntil
        : kind === "initial_in_progress" || kind === "retry_in_progress"
          ? item.deadlineAt ?? item.availableUntil
          : null,
  };
}

export function learningActivityEffectiveAt(item: LearningActivityOrderInput) {
  return deriveLearningActivityState(item).effectiveAt;
}

export function activityPassed(item: LearningActivityOrderInput) {
  return deriveLearningActivityState(item).passed;
}

export function activityNeedsRetry(item: LearningActivityOrderInput) {
  return deriveLearningActivityState(item).needsRetry;
}

export function learningActivitySection(item: LearningActivityOrderInput) {
  return deriveLearningActivityState(item).section;
}

export function learningActivityBucket(
  item: LearningActivityOrderInput,
): LearningActivityBucket {
  const state = deriveLearningActivityState(item);
  if (state.section === "archived") return "archived";
  if (state.section === "needs_attention") return "needs_attention";
  if (state.section === "completed") return "completed";
  if (state.kind === "not_started") {
    return item.availableUntil
      ? "open_with_deadline"
      : "open_without_deadline";
  }
  return "in_progress";
}

const sectionOrder: Record<LearningActivitySection, number> = {
  open: 0,
  needs_attention: 1,
  completed: 2,
  archived: 3,
};

const activeActivityKinds = new Set<LearningActivityKind>([
  "initial_in_progress",
  "review_pending",
  "retry_in_progress",
]);

export function compareLearningActivities(
  left: LearningActivityOrderInput,
  right: LearningActivityOrderInput,
) {
  const leftState = deriveLearningActivityState(left);
  const rightState = deriveLearningActivityState(right);
  const sectionDifference =
    sectionOrder[leftState.section] - sectionOrder[rightState.section];
  if (sectionDifference !== 0) return sectionDifference;

  const leftInProgress = activeActivityKinds.has(leftState.kind);
  const rightInProgress = activeActivityKinds.has(rightState.kind);
  if (leftInProgress !== rightInProgress) return leftInProgress ? -1 : 1;
  if (leftInProgress && rightInProgress) {
    const deadlineDifference =
      timestamp(leftState.urgencyDeadline, Number.MAX_SAFE_INTEGER) -
      timestamp(rightState.urgencyDeadline, Number.MAX_SAFE_INTEGER);
    if (deadlineDifference !== 0) return deadlineDifference;
    const activityDifference =
      timestamp(rightState.effectiveAt) - timestamp(leftState.effectiveAt);
    if (activityDifference !== 0) return activityDifference;
  }

  if (leftState.section === "open") {
    const deadlinePresenceDifference =
      Number(left.availableUntil !== null) -
      Number(right.availableUntil !== null);
    if (deadlinePresenceDifference !== 0) return deadlinePresenceDifference;
    const deadlineDifference =
      timestamp(left.availableUntil, Number.MAX_SAFE_INTEGER) -
      timestamp(right.availableUntil, Number.MAX_SAFE_INTEGER);
    return deadlineDifference !== 0
      ? deadlineDifference
      : timestamp(right.assignedAt) - timestamp(left.assignedAt);
  }

  return timestamp(rightState.effectiveAt) - timestamp(leftState.effectiveAt);
}

export function sortLearningActivities(items: AssignmentHistorySummary[]) {
  return items.toSorted(compareLearningActivities);
}

export function compareAdminHistoryRecency(
  left: AssignmentHistorySummary,
  right: AssignmentHistorySummary,
) {
  const dateDifference =
    timestamp(deriveLearningActivityState(right).effectiveAt) -
    timestamp(deriveLearningActivityState(left).effectiveAt);
  return dateDifference !== 0
    ? dateDifference
    : left.id.localeCompare(right.id, "ko-KR");
}

export function adminHistoryActivityGroups(
  items: readonly AssignmentHistorySummary[],
) {
  const groups = {
    open: [] as AssignmentHistorySummary[],
    needsAttention: [] as AssignmentHistorySummary[],
    completed: [] as AssignmentHistorySummary[],
    archived: [] as AssignmentHistorySummary[],
  };

  for (const item of items) {
    const section = deriveLearningActivityState(item).section;
    if (section === "open") groups.open.push(item);
    if (section === "needs_attention") groups.needsAttention.push(item);
    if (section === "completed") groups.completed.push(item);
    if (section === "archived") groups.archived.push(item);
  }

  for (const group of Object.values(groups)) {
    group.sort(compareAdminHistoryRecency);
  }

  return groups;
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

  const state = deriveLearningActivityState(item);
  if (filters.status !== "all" && state.section !== filters.status) {
    return false;
  }

  return (
    filters.since === null || timestamp(state.effectiveAt) >= filters.since
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
  const groups = adminHistoryActivityGroups(
    items.filter((item) => !item.assignmentDeleted && !item.studentDeleted),
  );
  return {
    open: groups.open,
    needsAttention: groups.needsAttention,
    completed: groups.completed,
  };
}
