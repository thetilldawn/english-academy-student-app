import { describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { buildActivityStatusTimeline } from "@/features/history/presentation/activity-presentation";

function activity(
  overrides: Partial<AssignmentHistorySummary>,
): AssignmentHistorySummary {
  return {
    id: "activity-1",
    assignmentId: "22222222-2222-4222-8222-222222222222",
    assignmentTitle: "테스트 시험",
    assignmentDeleted: false,
    assignmentStatus: "active",
    assignmentPurpose: "regular",
    studentId: "33333333-3333-4333-8333-333333333333",
    studentName: "테스트 학생",
    studentDeleted: false,
    studentStatus: "active",
    schoolName: "테스트고",
    gradeLabel: "고3",
    datasetId: "dataset-1",
    datasetTitle: "테스트 단어장",
    unitIds: [],
    unitLabels: [],
    primaryUnitIds: [],
    primaryUnitLabels: [],
    questionCount: 20,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    passingScore: 80,
    questionOrderMode: "random",
    availableFrom: null,
    availableUntil: "2026-08-09T06:20:00.000Z",
    assignedAt: "2026-08-08T00:00:00.000Z",
    missedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    attemptId: null,
    attemptNumber: null,
    status: "not_started",
    phase: null,
    activityAt: "2026-08-08T00:00:00.000Z",
    initialCorrectCount: null,
    retryCorrectCount: null,
    unresolvedWrongCount: null,
    initialScore: null,
    finalScore: null,
    passed: null,
    startedAt: null,
    initialCompletedAt: null,
    retryStartedAt: null,
    deadlineAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("buildActivityStatusTimeline", () => {
  it("shows a deadline and leaves not-started without an event time", () => {
    expect(buildActivityStatusTimeline(activity({}))).toEqual({
      deadline: {
        kind: "deadline",
        label: "마감",
        tone: "neutral",
        timestamp: "2026-08-09T06:20:00.000Z",
      },
      status: {
        kind: "status",
        label: "응시 전",
        tone: "neutral",
        timestamp: null,
      },
    });
  });

  it("keeps the assigned time when a not-started exam has no deadline", () => {
    expect(
      buildActivityStatusTimeline(activity({ availableUntil: null })),
    ).toEqual({
      deadline: {
        kind: "assigned",
        label: "배정",
        tone: "neutral",
        timestamp: "2026-08-08T00:00:00.000Z",
      },
      status: {
        kind: "status",
        label: "응시 전",
        tone: "neutral",
        timestamp: null,
      },
    });
  });

  it("shows cancellation only with its cancellation time", () => {
    expect(
      buildActivityStatusTimeline(
        activity({
          status: "cancelled",
          cancelledAt: "2026-08-08T03:00:00.000Z",
        }),
      ),
    ).toEqual({
      deadline: null,
      status: {
        kind: "status",
        label: "배정 취소",
        tone: "neutral",
        timestamp: "2026-08-08T03:00:00.000Z",
      },
    });
  });

  it("distinguishes retry waiting, retry running, and retry completion", () => {
    const waiting = buildActivityStatusTimeline(
      activity({
        attemptId: "11111111-1111-4111-8111-111111111111",
        status: "in_progress",
        phase: "review",
        initialScore: 50,
        finalScore: 50,
        initialCompletedAt: "2026-08-08T01:00:00.000Z",
      }),
    );
    const running = buildActivityStatusTimeline(
      activity({
        attemptId: "11111111-1111-4111-8111-111111111111",
        status: "in_progress",
        phase: "retry",
        initialScore: 50,
        finalScore: 50,
        retryStartedAt: "2026-08-08T02:00:00.000Z",
      }),
    );
    const passed = buildActivityStatusTimeline(
      activity({
        attemptId: "11111111-1111-4111-8111-111111111111",
        status: "completed",
        phase: "completed",
        initialScore: 50,
        finalScore: 100,
        retryStartedAt: "2026-08-08T02:00:00.000Z",
        completedAt: "2026-08-08T03:00:00.000Z",
      }),
    );

    expect(waiting.status).toMatchObject({ label: "미통과", tone: "danger" });
    expect(running.status).toMatchObject({ label: "재시험", tone: "warning" });
    expect(passed.status).toMatchObject({ label: "완료", tone: "warning" });
  });

  it("shows missed and expired states in danger with their confirmed time", () => {
    const missed = buildActivityStatusTimeline(
      activity({
        status: "missed",
        missedAt: "2026-08-09T06:20:00.000Z",
      }),
    );
    const expired = buildActivityStatusTimeline(
      activity({
        status: "expired",
        phase: "initial",
        deadlineAt: "2026-08-09T06:30:00.000Z",
      }),
    );

    expect(missed.status).toEqual({
      kind: "status",
      label: "미응시",
      tone: "danger",
      timestamp: "2026-08-09T06:20:00.000Z",
    });
    expect(expired.status).toEqual({
      kind: "status",
      label: "미통과",
      tone: "danger",
      timestamp: "2026-08-09T06:30:00.000Z",
    });
  });
});
