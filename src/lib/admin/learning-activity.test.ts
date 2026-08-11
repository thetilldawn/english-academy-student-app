import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import {
  activityNeedsRetry,
  activityPassed,
  adminHistoryActivityGroups,
  deriveLearningActivityState,
  learningActivityEffectiveAt,
  learningActivityBucket,
  learningActivitySection,
  matchesLearningHistoryFilters,
  overviewActivityGroups,
  sortLearningActivities,
} from "@/features/history/domain/learning-activity";

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
      "in-progress",
      "no-deadline",
      "deadline-near",
      "deadline-later",
      "failed",
      "passed",
      "cancelled",
    ]);
  });

  it("같은 마감이면 최근 배정을 먼저 둔다", () => {
    const result = sortLearningActivities([
      activity("older", {
        availableUntil: "2026-08-10T00:00:00.000Z",
        assignedAt: "2026-08-01T00:00:00.000Z",
      }),
      activity("newer", {
        availableUntil: "2026-08-10T00:00:00.000Z",
        assignedAt: "2026-08-02T00:00:00.000Z",
      }),
    ]);

    expect(result.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("이어 풀기와 재시험 대기는 가까운 진행 마감을 먼저 둔다", () => {
    const resumable = sortLearningActivities([
      activity("resume-later", {
        status: "in_progress",
        phase: "initial",
        startedAt: "2026-08-08T00:00:00.000Z",
        deadlineAt: "2026-08-09T03:00:00.000Z",
      }),
      activity("resume-near", {
        status: "in_progress",
        phase: "initial",
        startedAt: "2026-08-08T00:00:00.000Z",
        deadlineAt: "2026-08-09T01:00:00.000Z",
      }),
    ]);
    const retryReady = sortLearningActivities([
      activity("retry-later", {
        status: "in_progress",
        phase: "review",
        initialCompletedAt: "2026-08-08T00:00:00.000Z",
        availableUntil: "2026-08-09T03:00:00.000Z",
      }),
      activity("failed-newer", {
        status: "completed",
        finalScore: 70,
        completedAt: "2026-08-08T04:00:00.000Z",
      }),
      activity("retry-near", {
        status: "in_progress",
        phase: "review",
        initialCompletedAt: "2026-08-08T00:00:00.000Z",
        availableUntil: "2026-08-09T01:00:00.000Z",
      }),
    ]);

    expect(resumable.map((item) => item.id)).toEqual([
      "resume-near",
      "resume-later",
    ]);
    expect(retryReady.map((item) => item.id)).toEqual([
      "retry-near",
      "retry-later",
      "failed-newer",
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

  it("uses the available score before the passed flag and requires evidence for completion", () => {
    const initialOnlyFailure = activity("initial-only-failure", {
      status: "completed",
      initialScore: 70,
      finalScore: null,
      passed: true,
    });
    const passedWithoutScore = activity("passed-without-score", {
      status: "completed",
      initialScore: null,
      finalScore: null,
      passed: true,
    });
    const noCompletionEvidence = activity("no-completion-evidence", {
      status: "completed",
      initialScore: null,
      finalScore: null,
      passed: null,
    });

    expect(deriveLearningActivityState(initialOnlyFailure).kind).toBe("failed");
    expect(deriveLearningActivityState(passedWithoutScore).kind).toBe(
      "completed_first_try",
    );
    expect(deriveLearningActivityState(noCompletionEvidence).kind).toBe(
      "failed",
    );
  });

  it("keeps terminal status authoritative over a stale passing score", () => {
    const expired = activity("expired-with-stale-score", {
      status: "expired",
      finalScore: 100,
      passed: true,
      deadlineAt: "2026-08-09T00:00:00.000Z",
    });

    expect(deriveLearningActivityState(expired)).toMatchObject({
      kind: "expired",
      outcome: "failed",
      passed: false,
      section: "needs_attention",
      statusAt: "2026-08-09T00:00:00.000Z",
    });
  });

  it("orders deadline-free retries by retry start time before unstarted work", () => {
    const result = sortLearningActivities([
      activity("unstarted", {
        assignedAt: "2026-08-10T00:00:00.000Z",
      }),
      activity("retry-older", {
        status: "in_progress",
        phase: "retry",
        retryStartedAt: "2026-08-08T00:00:00.000Z",
      }),
      activity("retry-newer", {
        status: "in_progress",
        phase: "retry",
        retryStartedAt: "2026-08-09T00:00:00.000Z",
      }),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "retry-newer",
      "retry-older",
      "unstarted",
    ]);
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

  it("검토 단계는 첫 시험 확정 시각으로 정렬한다", () => {
    const review = activity("review", {
      status: "in_progress",
      phase: "review",
      startedAt: "2026-08-01T00:00:00.000Z",
      initialCompletedAt: "2026-08-08T00:00:00.000Z",
    });

    expect(learningActivityEffectiveAt(review)).toBe(
      "2026-08-08T00:00:00.000Z",
    );
    expect(learningActivitySection(review)).toBe("needs_attention");
  });

  it("미통과 시험은 남은 오답이 0개여도 미통과 구역에 둔다", () => {
    const failed = activity("failed-resolved", {
      status: "completed",
      finalScore: 70,
      unresolvedWrongCount: 0,
    });

    expect(learningActivitySection(failed)).toBe("needs_attention");
    expect(learningActivityBucket(failed)).toBe("needs_attention");
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
        assignedAt: "2026-08-04T00:00:00.000Z",
        availableUntil: "2026-08-10T00:00:00.000Z",
      }),
      activity("due-near", {
        assignedAt: "2026-08-03T00:00:00.000Z",
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
      activity("passed", {
        status: "completed",
        finalScore: 100,
        completedAt: "2026-08-06T00:00:00.000Z",
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

    expect(groups.open.map((item) => item.id)).toEqual([
      "due-later",
      "due-near",
      "no-deadline-new",
      "no-deadline-old",
    ]);
    expect(groups.needsAttention.map((item) => item.id)).toEqual([
      "missed",
      "failed",
    ]);
    expect(groups.completed.map((item) => item.id)).toEqual(["passed"]);
  });

  it("groups admin history by status and orders every group by newest activity date", () => {
    const groups = adminHistoryActivityGroups([
      activity("open-old", {
        assignedAt: "2026-08-01T00:00:00.000Z",
      }),
      activity("open-new", {
        assignedAt: "2026-08-08T00:00:00.000Z",
      }),
      activity("failed-old", {
        completedAt: "2026-08-02T00:00:00.000Z",
        finalScore: 50,
        status: "completed",
      }),
      activity("failed-new", {
        completedAt: "2026-08-09T00:00:00.000Z",
        finalScore: 70,
        status: "completed",
      }),
      activity("completed-old", {
        completedAt: "2026-08-03T00:00:00.000Z",
        finalScore: 90,
        status: "completed",
      }),
      activity("completed-new", {
        completedAt: "2026-08-10T00:00:00.000Z",
        finalScore: 100,
        status: "completed",
      }),
      activity("cancelled-old", {
        cancelledAt: "2026-08-04T00:00:00.000Z",
        status: "cancelled",
      }),
      activity("cancelled-new", {
        cancelledAt: "2026-08-11T00:00:00.000Z",
        status: "cancelled",
      }),
    ]);

    expect(groups.open.map((item) => item.id)).toEqual([
      "open-new",
      "open-old",
    ]);
    expect(groups.needsAttention.map((item) => item.id)).toEqual([
      "failed-new",
      "failed-old",
    ]);
    expect(groups.completed.map((item) => item.id)).toEqual([
      "completed-new",
      "completed-old",
    ]);
    expect(groups.archived.map((item) => item.id)).toEqual([
      "cancelled-new",
      "cancelled-old",
    ]);
  });
});
