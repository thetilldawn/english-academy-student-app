import type { StudentAssignmentSummary } from "../model";

export type StudentAssignmentWindow =
  | {
      kind: "scheduled";
      opensAt: string;
      closesAt: string | null;
    }
  | {
      kind: "open";
      opensAt: string | null;
      closesAt: string | null;
    }
  | {
      kind: "closed";
      opensAt: string | null;
      closesAt: string | null;
      reason: "admin" | "deadline" | "invalid_window";
    };

export type StudentAssignmentProgress =
  | "not_started"
  | "initial_in_progress"
  | "review_pending"
  | "retry_in_progress"
  | "completed"
  | "expired"
  | "missed";

export type StudentAssignmentLifecycle = {
  actions: {
    canReviewAndRetry: boolean;
    canResume: boolean;
    canStart: boolean;
    canViewResult: boolean;
  };
  progress: StudentAssignmentProgress;
  window: StudentAssignmentWindow;
};

type LifecycleInput = Pick<
  StudentAssignmentSummary,
  | "assignmentStatus"
  | "availableFrom"
  | "availableUntil"
  | "lastAttemptId"
  | "lastPhase"
  | "lastStatus"
  | "missedAt"
  | "retakeAllowed"
>;

function boundary(value: string | null) {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function deriveWindow(
  assignment: LifecycleInput,
  nowMilliseconds: number,
): StudentAssignmentWindow {
  const opensAt = boundary(assignment.availableFrom);
  const closesAt = boundary(assignment.availableUntil);
  if (Number.isNaN(opensAt) || Number.isNaN(closesAt)) {
    return {
      kind: "closed",
      opensAt: assignment.availableFrom,
      closesAt: assignment.availableUntil,
      reason: "invalid_window",
    };
  }
  if (opensAt !== null && closesAt !== null && closesAt <= opensAt) {
    return {
      kind: "closed",
      opensAt: assignment.availableFrom,
      closesAt: assignment.availableUntil,
      reason: "invalid_window",
    };
  }
  if (assignment.assignmentStatus !== "active") {
    return {
      kind: "closed",
      opensAt: assignment.availableFrom,
      closesAt: assignment.availableUntil,
      reason: "admin",
    };
  }
  if (opensAt !== null && opensAt > nowMilliseconds) {
    return {
      kind: "scheduled",
      opensAt: assignment.availableFrom!,
      closesAt: assignment.availableUntil,
    };
  }
  if (closesAt !== null && closesAt <= nowMilliseconds) {
    return {
      kind: "closed",
      opensAt: assignment.availableFrom,
      closesAt: assignment.availableUntil,
      reason: "deadline",
    };
  }
  return {
    kind: "open",
    opensAt: assignment.availableFrom,
    closesAt: assignment.availableUntil,
  };
}

function deriveProgress(
  assignment: LifecycleInput,
  availabilityWindow: StudentAssignmentWindow,
): StudentAssignmentProgress {
  if (assignment.lastStatus === "in_progress") {
    if (assignment.lastPhase === "review") return "review_pending";
    if (assignment.lastPhase === "retry") return "retry_in_progress";
    return "initial_in_progress";
  }
  if (assignment.lastStatus === "completed") return "completed";
  if (assignment.lastStatus === "expired") return "expired";
  if (
    assignment.missedAt !== null ||
    (availabilityWindow.kind === "closed" &&
      availabilityWindow.reason === "deadline")
  ) {
    return "missed";
  }
  return "not_started";
}

export function deriveStudentAssignmentLifecycle(
  assignment: LifecycleInput,
  nowMilliseconds: number,
): StudentAssignmentLifecycle {
  const availabilityWindow = deriveWindow(assignment, nowMilliseconds);
  const progress = deriveProgress(assignment, availabilityWindow);
  const hasAttempt = assignment.lastAttemptId !== null;
  const canStart =
    availabilityWindow.kind === "open" &&
    ((!hasAttempt && progress === "not_started") ||
      (hasAttempt && progress === "expired") ||
      (hasAttempt &&
        progress === "completed" &&
        assignment.retakeAllowed));

  return {
    actions: {
      canReviewAndRetry: hasAttempt && progress === "review_pending",
      canResume:
        hasAttempt &&
        (progress === "initial_in_progress" ||
          progress === "retry_in_progress"),
      canStart,
      canViewResult:
        hasAttempt && (progress === "completed" || progress === "expired"),
    },
    progress,
    window: availabilityWindow,
  };
}
