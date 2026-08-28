export const assignmentEditFieldKeys = [
  "title",
  "dataset",
  "range",
  "questionCount",
  "direction",
  "order",
  "timing",
  "passingScore",
  "retry",
  "availableFrom",
  "deadline",
  "review",
] as const;

export type AssignmentEditFieldKey =
  (typeof assignmentEditFieldKeys)[number];
export type AssignmentEditPurpose = "regular" | "mixed" | "review";
export type AssignmentReviewScope = "dataset" | "selection";

export type AssignmentEditFieldRule =
  | "editable"
  | "ui_hidden"
  | "locked";

export type AssignmentEditFieldPolicy = Readonly<
  Record<AssignmentEditFieldKey, AssignmentEditFieldRule>
>;

const regularPolicy = {
  title: "ui_hidden",
  dataset: "editable",
  range: "editable",
  questionCount: "editable",
  direction: "editable",
  order: "editable",
  timing: "editable",
  passingScore: "editable",
  retry: "editable",
  availableFrom: "editable",
  deadline: "editable",
  review: "locked",
} as const satisfies AssignmentEditFieldPolicy;

const mixedPolicy = {
  ...regularPolicy,
  dataset: "locked",
  range: "locked",
  questionCount: "locked",
  direction: "locked",
  review: "locked",
} as const satisfies AssignmentEditFieldPolicy;

const reviewPolicy = {
  ...mixedPolicy,
  direction: "editable",
} as const satisfies AssignmentEditFieldPolicy;

const policies = {
  regular: regularPolicy,
  mixed: mixedPolicy,
  review: reviewPolicy,
} as const satisfies Record<AssignmentEditPurpose, AssignmentEditFieldPolicy>;

export function assignmentEditFieldPolicy(
  purpose: AssignmentEditPurpose,
  context: { seriesItem?: boolean } = {},
): AssignmentEditFieldPolicy {
  const policy = policies[purpose];
  return context.seriesItem && policy.dataset === "editable"
    ? { ...policy, dataset: "locked" }
    : policy;
}

export type AssignmentEditComparable = {
  title: string;
  datasetId: string;
  primaryUnitIds: readonly string[];
  questionCount: number;
  englishToKoreanRatio: number;
  timeLimitSeconds: number;
  timingMode: string;
  questionTimeLimitSeconds: number | null;
  passingScore: number;
  retryEnabled: boolean;
  retryPassingScore: number | null;
  questionOrderMode: string;
  availableFrom: string | null;
  availableUntil: string | null;
  includePendingReview: boolean;
  reviewScope: AssignmentReviewScope;
  reviewLevels: readonly number[];
};

function sameOrderedValues(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameNumberSet(left: readonly number[], right: readonly number[]) {
  return sameOrderedValues([...left].toSorted(), [...right].toSorted());
}

export function assignmentEditChangeKeys(
  before: AssignmentEditComparable,
  after: AssignmentEditComparable,
): AssignmentEditFieldKey[] {
  const changes: AssignmentEditFieldKey[] = [];
  if (before.title !== after.title) changes.push("title");
  if (before.datasetId !== after.datasetId) changes.push("dataset");
  if (!sameOrderedValues(before.primaryUnitIds, after.primaryUnitIds)) {
    changes.push("range");
  }
  if (before.questionCount !== after.questionCount) {
    changes.push("questionCount");
  }
  if (before.englishToKoreanRatio !== after.englishToKoreanRatio) {
    changes.push("direction");
  }
  if (before.questionOrderMode !== after.questionOrderMode) {
    changes.push("order");
  }
  if (
    before.timingMode !== after.timingMode ||
    before.timeLimitSeconds !== after.timeLimitSeconds ||
    before.questionTimeLimitSeconds !== after.questionTimeLimitSeconds
  ) {
    changes.push("timing");
  }
  if (before.passingScore !== after.passingScore) {
    changes.push("passingScore");
  }
  if (
    before.retryEnabled !== after.retryEnabled ||
    before.retryPassingScore !== after.retryPassingScore
  ) {
    changes.push("retry");
  }
  if (before.availableFrom !== after.availableFrom) {
    changes.push("availableFrom");
  }
  if (before.availableUntil !== after.availableUntil) {
    changes.push("deadline");
  }
  if (
    before.includePendingReview !== after.includePendingReview ||
    (before.includePendingReview &&
      after.includePendingReview &&
      (before.reviewScope !== after.reviewScope ||
        !sameNumberSet(before.reviewLevels, after.reviewLevels)))
  ) {
    changes.push("review");
  }
  return changes;
}

export function lockedAssignmentEditChangeKeys(
  purpose: AssignmentEditPurpose,
  before: AssignmentEditComparable,
  after: AssignmentEditComparable,
  context: { seriesItem?: boolean } = {},
): AssignmentEditFieldKey[] {
  const policy = assignmentEditFieldPolicy(purpose, context);
  return assignmentEditChangeKeys(before, after).filter(
    (field) => policy[field] === "locked",
  );
}

export type AssignmentEditAvailabilityInput = {
  status: string;
  attemptId: string | null;
  attemptCount?: number;
  hasCompletedAttempt?: boolean;
  cancelled?: boolean;
  missed?: boolean;
  assignmentDeleted: boolean;
  assignmentStatus: "draft" | "active" | "closed";
  availableUntil: string | null;
  studentDeleted: boolean;
  studentStatus: "active" | "blocked";
};

export type AssignmentEditUnavailableReason =
  | "blocked"
  | "started"
  | "completed"
  | "missed"
  | "cancelled"
  | "deleted"
  | "closed"
  | "deadline_elapsed";

export function assignmentEditUnavailableReason(
  item: AssignmentEditAvailabilityInput,
  nowMilliseconds: number,
): AssignmentEditUnavailableReason | null {
  if (item.assignmentDeleted || item.studentDeleted) return "deleted";
  if (item.studentStatus !== "active") return "blocked";
  if (item.cancelled || item.status === "cancelled") return "cancelled";
  if (item.missed || item.status === "missed") return "missed";
  if (
    item.hasCompletedAttempt ||
    item.status === "completed" ||
    item.status === "expired"
  ) {
    return "completed";
  }
  if (
    item.attemptId !== null ||
    (item.attemptCount !== undefined && item.attemptCount > 0) ||
    item.status !== "not_started"
  ) {
    return "started";
  }
  if (
    item.availableUntil &&
    Date.parse(item.availableUntil) <= nowMilliseconds
  ) {
    return "deadline_elapsed";
  }
  if (item.assignmentStatus !== "active") return "closed";
  return null;
}

export function isAssignmentEditAvailable(
  item: AssignmentEditAvailabilityInput,
  nowMilliseconds: number,
) {
  return assignmentEditUnavailableReason(item, nowMilliseconds) === null;
}
