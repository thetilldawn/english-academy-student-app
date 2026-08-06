import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import {
  activityPassed,
  learningActivityBucket,
  sortLearningActivities,
} from "@/lib/admin/learning-activity";

function activity(
  id: string,
  overrides: Partial<AssignmentHistorySummary>,
): AssignmentHistorySummary {
  return {
    id,
    assignmentId: `assignment-${id}`,
    assignmentTitle: id,
    assignmentDeleted: false,
    assignmentStatus: "active",
    assignmentPurpose: "regular",
    studentId: "student-1",
    studentName: "테스트 학생",
    studentDeleted: false,
    schoolName: "테스트고",
    gradeLabel: "고3",
    datasetId: "dataset-1",
    datasetTitle: "테스트 단어장",
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    primaryUnitIds: ["unit-1"],
    primaryUnitLabels: ["DAY 01"],
    questionCount: 20,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    passingScore: 80,
    questionOrderMode: "random",
    availableUntil: null,
    assignedAt: "2026-08-01T00:00:00.000Z",
    missedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    attemptId: null,
    attemptNumber: null,
    status: "not_started",
    phase: null,
    activityAt: "2026-08-01T00:00:00.000Z",
    initialCorrectCount: null,
    retryCorrectCount: null,
    unresolvedWrongCount: null,
    initialScore: null,
    finalScore: null,
    passed: null,
    startedAt: null,
    retryStartedAt: null,
    deadlineAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("learning activity ordering", () => {
  it("orders no-deadline, nearest deadline, in-progress, failed, passed, archived", () => {
    const result = sortLearningActivities([
      activity("passed", {
        status: "completed",
        finalScore: 100,
        completedAt: "2026-08-06T00:00:00.000Z",
      }),
      activity("deadline-later", {
        availableUntil: "2026-08-10T00:00:00.000Z",
      }),
      activity("cancelled", {
        status: "cancelled",
        cancelledAt: "2026-08-07T00:00:00.000Z",
      }),
      activity("failed", {
        status: "completed",
        finalScore: 75,
        completedAt: "2026-08-05T00:00:00.000Z",
      }),
      activity("deadline-near", {
        availableUntil: "2026-08-09T00:00:00.000Z",
      }),
      activity("in-progress", {
        status: "in_progress",
        phase: "initial",
        startedAt: "2026-08-04T00:00:00.000Z",
      }),
      activity("no-deadline", {}),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "no-deadline",
      "deadline-near",
      "deadline-later",
      "in-progress",
      "failed",
      "passed",
      "cancelled",
    ]);
  });

  it("derives completion from the displayed final score", () => {
    const stalePassedFlag = activity("stale", {
      status: "completed",
      finalScore: 70,
      passed: true,
    });
    expect(activityPassed(stalePassedFlag)).toBe(false);
    expect(learningActivityBucket(stalePassedFlag)).toBe("needs_attention");
  });
});
