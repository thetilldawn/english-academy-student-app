import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { summarizeStudentDirectoryActivities } from "./student-directory-summary";

function activity(
  id: string,
  overrides: Partial<AssignmentHistorySummary> = {},
): AssignmentHistorySummary {
  return {
    activityAt: "2026-08-01T00:00:00.000Z",
    assignedAt: "2026-08-01T00:00:00.000Z",
    assignmentDeleted: false,
    assignmentId: `assignment-${id}`,
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    assignmentTitle: id,
    attemptId: null,
    attemptNumber: null,
    availableFrom: null,
    availableUntil: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    datasetId: "dataset-1",
    datasetTitle: "단어장",
    deadlineAt: null,
    englishToKoreanRatio: 50,
    finalScore: null,
    gradeLabel: "고3",
    id,
    initialCompletedAt: null,
    initialCorrectCount: null,
    initialScore: null,
    missedAt: null,
    passed: null,
    passingScore: 80,
    phase: null,
    primaryUnitIds: ["unit-1"],
    primaryUnitLabels: ["DAY 01"],
    questionCount: 20,
    questionOrderMode: "random",
    questionTimeLimitSeconds: null,
    retryCorrectCount: null,
    retryStartedAt: null,
    schoolName: "학교",
    startedAt: null,
    status: "not_started",
    studentDeleted: false,
    studentId: "student-1",
    studentName: "학생",
    studentStatus: "active",
    timeLimitSeconds: 300,
    timingMode: "total",
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    unresolvedWrongCount: null,
    ...overrides,
  };
}

describe("summarizeStudentDirectoryActivities", () => {
  it("counts the three directory states and ignores assignment time as a test date", () => {
    const summary = summarizeStudentDirectoryActivities([
      activity("not-started"),
      activity("missed", {
        missedAt: "2026-08-03T00:00:00.000Z",
        status: "missed",
      }),
      activity("completed", {
        completedAt: "2026-08-04T10:00:00.000Z",
        finalScore: 100,
        initialCompletedAt: "2026-08-04T09:55:00.000Z",
        initialScore: 100,
        passed: true,
        phase: "completed",
        startedAt: "2026-08-04T09:50:00.000Z",
        status: "completed",
      }),
    ]);

    expect(summary).toEqual({
      completedCount: 1,
      missedCount: 1,
      notStartedCount: 1,
      recentAttemptAt: "2026-08-04T10:00:00.000Z",
    });
  });

  it("counts a finished failed attempt as completed work", () => {
    const summary = summarizeStudentDirectoryActivities([
      activity("failed", {
        completedAt: "2026-08-05T00:00:00.000Z",
        finalScore: 50,
        initialCompletedAt: "2026-08-05T00:00:00.000Z",
        initialScore: 50,
        passed: false,
        phase: "completed",
        status: "completed",
      }),
    ]);

    expect(summary.completedCount).toBe(1);
  });
});
