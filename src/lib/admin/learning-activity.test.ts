import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import {
  activityNeedsRetry,
  activityPassed,
  learningActivityEffectiveAt,
  learningActivityBucket,
  matchesLearningHistoryFilters,
  overviewActivityGroups,
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
    studentStatus: "active",
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

  it("does not classify a missed assignment as a retry", () => {
    expect(activityNeedsRetry(activity("missed", { status: "missed" }))).toBe(
      false,
    );
    expect(
      activityNeedsRetry(
        activity("failed", {
          status: "completed",
          finalScore: 70,
          unresolvedWrongCount: 3,
        }),
      ),
    ).toBe(true);
    expect(
      activityNeedsRetry(
        activity("resolved", {
          status: "completed",
          finalScore: 70,
          unresolvedWrongCount: 0,
        }),
      ),
    ).toBe(false);
  });

  it("uses an expired deadline for ordering and period filters", () => {
    const expired = activity("expired", {
      status: "expired",
      activityAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      deadlineAt: "2026-08-07T00:00:00.000Z",
    });
    const olderFailure = activity("older-failure", {
      status: "completed",
      finalScore: 70,
      completedAt: "2026-08-06T00:00:00.000Z",
    });

    expect(learningActivityEffectiveAt(expired)).toBe(
      "2026-08-07T00:00:00.000Z",
    );
    expect(sortLearningActivities([olderFailure, expired])[0]?.id).toBe(
      "expired",
    );
    expect(
      matchesLearningHistoryFilters(expired, {
        purpose: "all",
        status: "needs_attention",
        since: Date.parse("2026-08-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("filters history by type, status, and period together", () => {
    const failedReview = activity("failed-review", {
      assignmentPurpose: "review",
      status: "completed",
      finalScore: 70,
      activityAt: "2026-08-05T00:00:00.000Z",
    });
    expect(
      matchesLearningHistoryFilters(failedReview, {
        purpose: "review",
        status: "needs_attention",
        since: Date.parse("2026-08-01T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      matchesLearningHistoryFilters(failedReview, {
        purpose: "regular",
        status: "needs_attention",
        since: null,
      }),
    ).toBe(false);
    expect(
      matchesLearningHistoryFilters(failedReview, {
        purpose: "review",
        status: "needs_attention",
        since: Date.parse("2026-08-06T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("builds actionable overview groups without deleted records", () => {
    const groups = overviewActivityGroups([
      activity("no-deadline-new", {
        assignedAt: "2026-08-02T00:00:00.000Z",
      }),
      activity("no-deadline-old", {
        assignedAt: "2026-08-01T00:00:00.000Z",
      }),
      activity("due-later", {
        availableUntil: "2026-08-10T00:00:00.000Z",
      }),
      activity("due-near", {
        availableUntil: "2026-08-09T00:00:00.000Z",
      }),
      activity("missed", {
        status: "missed",
        missedAt: "2026-08-08T00:00:00.000Z",
      }),
      activity("failed", {
        status: "completed",
        finalScore: 70,
        completedAt: "2026-08-07T00:00:00.000Z",
      }),
      activity("deleted-assignment", {
        assignmentDeleted: true,
        status: "missed",
      }),
      activity("deleted-student", {
        studentDeleted: true,
        status: "completed",
        finalScore: 50,
      }),
    ]);

    expect(groups.missed.map((item) => item.id)).toEqual(["missed"]);
    expect(groups.failed.map((item) => item.id)).toEqual(["failed"]);
    expect(groups.dueSoon.map((item) => item.id)).toEqual([
      "due-near",
      "due-later",
    ]);
    expect(groups.noDeadline.map((item) => item.id)).toEqual([
      "no-deadline-old",
      "no-deadline-new",
    ]);
  });
});
