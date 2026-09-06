import type { StudentAssignmentSummary } from "../model";
import { isAssignmentReleaseOpen } from "@/lib/assignment/assignment-release";

export type StudentAssignmentWindow =
  | {
      kind: "scheduled";
      opensAt: string | null;
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
      reason: "admin" | "deadline" | "invalid_window" | "held" | "release_schedule";
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
    canViewWords: boolean;
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
  | "release"
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
  // Existing attempts keep their original resume/retry/result lifecycle.
  // A new INSERT (including a retake) is still checked separately below and in DB.
  if (!assignment.lastAttemptId && !isAssignmentReleaseOpen(assignment.release)) {
    const release = assignment.release!;
    if (release.state === "waiting_initial" || release.state === "waiting_time") {
      return {
        kind: "scheduled",
        opensAt: release.state === "waiting_time" ? release.opensAt : null,
        closesAt: assignment.availableUntil,
      };
    }
    return {
      kind: "closed", opensAt: release.opensAt, closesAt: assignment.availableUntil,
      reason: release.state === "cancelled" ? "admin" : release.state === "held" ? "held" : "release_schedule",
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
  if (availabilityWindow.kind === "closed" &&
      (availabilityWindow.reason === "held" || availabilityWindow.reason === "release_schedule")) {
    return "not_started";
  }
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
    isAssignmentReleaseOpen(assignment.release) &&
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
      canViewWords: hasAttempt || isAssignmentReleaseOpen(assignment.release),
      canViewResult:
        hasAttempt && (progress === "completed" || progress === "expired"),
    },
    progress,
    window: availabilityWindow,
  };
}
