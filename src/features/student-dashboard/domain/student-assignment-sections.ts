import {
  compareLearningActivities,
  deriveLearningActivityState,
  type LearningActivityOrderInput,
} from "@/features/history/domain/learning-activity";
import type { ActivityTimelineInput } from "@/features/history/presentation/activity-presentation";

import type { StudentAssignmentSummary } from "../model";
import { deriveStudentAssignmentLifecycle } from "./student-assignment-lifecycle";

export type StudentAssignmentSectionId =
  | "open"
  | "scheduled"
  | "needs-attention"
  | "deadline-closed"
  | "completed";

export type StudentAssignmentSection = {
  id: StudentAssignmentSectionId;
  assignments: StudentAssignmentSummary[];
};

export function studentAssignmentActivityInput(
  assignment: StudentAssignmentSummary,
): LearningActivityOrderInput {
  return {
    status:
      assignment.lastStatus ?? (assignment.missedAt ? "missed" : "not_started"),
    phase: assignment.lastPhase,
    assignedAt: assignment.assignedAt,
    availableUntil: assignment.availableUntil,
    startedAt: assignment.lastStartedAt,
    initialCompletedAt: assignment.lastInitialCompletedAt,
    retryStartedAt: assignment.lastRetryStartedAt,
    completedAt: assignment.lastCompletedAt,
    missedAt: assignment.missedAt,
    deadlineAt: assignment.lastDeadlineAt,
    activityAt:
      assignment.lastCompletedAt ??
      assignment.lastRetryStartedAt ??
      assignment.lastInitialCompletedAt ??
      assignment.lastStartedAt ??
      assignment.missedAt ??
      assignment.assignedAt,
    passed: assignment.lastPassed,
    initialScore: assignment.lastInitialScore,
    finalScore: assignment.lastFinalScore,
    passingScore: assignment.passingScore,
    unresolvedWrongCount: assignment.lastUnresolvedWrongCount,
  };
}

export function studentAssignmentTimeline(
  assignment: StudentAssignmentSummary,
): ActivityTimelineInput {
  const activity = studentAssignmentActivityInput(assignment);
  const displayedDeadline =
    assignment.lastStatus === "in_progress" &&
    assignment.lastPhase !== "review"
      ? (assignment.lastDeadlineAt ?? assignment.availableUntil)
      : assignment.availableUntil;
  return {
    ...activity,
    status: activity.status ?? "not_started",
    assignedAt: assignment.assignedAt,
    phase: assignment.lastPhase,
    initialScore: assignment.lastInitialScore,
    finalScore: assignment.lastFinalScore,
    passingScore: assignment.passingScore,
    retryStartedAt: assignment.lastRetryStartedAt,
    cancelledAt: null,
    availableUntil: displayedDeadline,
  };
}

export function compareStudentAssignments(
  left: StudentAssignmentSummary,
  right: StudentAssignmentSummary,
) {
  const comparison = compareLearningActivities(
    studentAssignmentActivityInput(left),
    studentAssignmentActivityInput(right),
  );
  return comparison !== 0 ? comparison : left.id.localeCompare(right.id);
}

export function sortStudentAssignments(
  assignments: readonly StudentAssignmentSummary[],
) {
  return assignments.toSorted(compareStudentAssignments);
}

export function selectStudentAssignmentSections(
  assignments: readonly StudentAssignmentSummary[],
  nowMilliseconds = Date.now(),
): StudentAssignmentSection[] {
  const sections: StudentAssignmentSection[] = [
    { id: "open", assignments: [] },
    { id: "scheduled", assignments: [] },
    { id: "needs-attention", assignments: [] },
    { id: "completed", assignments: [] },
    { id: "deadline-closed", assignments: [] },
  ];
  const sectionById = new Map(sections.map((section) => [section.id, section]));

  for (const assignment of sortStudentAssignments(assignments)) {
    const lifecycle = deriveStudentAssignmentLifecycle(
      assignment,
      nowMilliseconds,
    );
    const state = deriveLearningActivityState(
      studentAssignmentActivityInput(assignment),
    );
    const sectionId: StudentAssignmentSectionId =
      lifecycle.progress === "not_started" &&
      lifecycle.window.kind === "scheduled"
        ? "scheduled"
        : lifecycle.progress === "not_started" &&
            lifecycle.window.kind === "closed"
          ? "deadline-closed"
          : lifecycle.progress === "missed"
            ? "deadline-closed"
            : state.section === "needs_attention"
              ? "needs-attention"
              : state.section === "completed"
                ? "completed"
                : "open";
    sectionById.get(sectionId)?.assignments.push(assignment);
  }

  sectionById.get("scheduled")?.assignments.sort((left, right) => {
    const openingDifference = Date.parse(left.availableFrom ?? "") -
      Date.parse(right.availableFrom ?? "");
    return openingDifference !== 0
      ? openingDifference
      : compareStudentAssignments(left, right);
  });

  return sections;
}
