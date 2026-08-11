/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";

import { AdminHistoryDetailContent } from "./admin-history-detail";

afterEach(cleanup);

function summary(): AssignmentHistorySummary {
  return {
    activityAt: "2026-08-11T00:02:00.000Z",
    assignedAt: "2026-08-11T00:00:00.000Z",
    assignmentDeleted: false,
    assignmentId: "assignment-1",
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    assignmentTitle: "DAY 01",
    attemptId: "attempt-1",
    attemptNumber: 1,
    availableUntil: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: "2026-08-11T00:02:00.000Z",
    datasetId: "dataset-1",
    datasetTitle: "능률 VOCA",
    deadlineAt: "2026-08-11T00:05:00.000Z",
    englishToKoreanRatio: 100,
    finalScore: 100,
    gradeLabel: "고3",
    id: "history-1",
    initialCompletedAt: "2026-08-11T00:01:00.000Z",
    initialCorrectCount: 0,
    initialScore: 0,
    missedAt: null,
    passed: true,
    passingScore: 80,
    phase: "completed",
    primaryUnitIds: ["unit-1"],
    primaryUnitLabels: ["DAY 01"],
    questionCount: 1,
    questionOrderMode: "random",
    retryCorrectCount: 1,
    retryStartedAt: "2026-08-11T00:01:10.000Z",
    schoolName: "미리보기고",
    startedAt: "2026-08-11T00:00:10.000Z",
    status: "completed",
    studentDeleted: false,
    studentId: "student-1",
    studentName: "프리뷰 학생",
    studentStatus: "active",
    timeLimitSeconds: 300,
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    unresolvedWrongCount: 0,
  };
}

function detail(retryIsCorrect: boolean): AdminHistoryDetail {
  return {
    canonicalKey: "attempt.attempt-1",
    summary: summary(),
    attempt: {
      id: "attempt-1",
      studentName: "프리뷰 학생",
      assignmentTitle: "DAY 01",
      attemptNumber: 1,
      status: "completed",
      phase: "completed",
      initialScore: 0,
      finalScore: retryIsCorrect ? 100 : 0,
      passed: retryIsCorrect,
      questionCount: 1,
      initialCorrectCount: 0,
      retryCorrectCount: retryIsCorrect ? 1 : 0,
      unresolvedWrongCount: retryIsCorrect ? 0 : 1,
      startedAt: "2026-08-11T00:00:10.000Z",
      completedAt: "2026-08-11T00:02:00.000Z",
      elapsedSeconds: 110,
      questions: [
        {
          id: "question-1",
          orderIndex: 1,
          direction: "english_to_korean",
          prompt: "observe",
          correctAnswer: "준수하다",
          correctChoiceIndex: 2,
          initialChoice: "관찰하다",
          initialIsCorrect: false,
          retryChoice: retryIsCorrect ? "준수하다" : "기념하다",
          retryIsCorrect,
          wrongCount: retryIsCorrect ? 1 : 2,
          headword: "observe",
          primaryMeaning: "준수하다",
          provenanceStatus: "verified_v2",
        },
      ],
    },
  };
}

describe("AdminHistoryDetailContent", () => {
  it("does not repeat the correct answer after a successful retry", () => {
    render(<AdminHistoryDetailContent detail={detail(true)} />);

    expect(screen.getAllByText("준수하다")).toHaveLength(1);
    expect(screen.getByText("한 번 틀린 단어")).toBeVisible();
    expect(screen.queryByText("정답")).not.toBeInTheDocument();
  });

  it("shows the correct answer as a third step while the retry remains wrong", () => {
    render(<AdminHistoryDetailContent detail={detail(false)} />);

    expect(screen.getByText("정답")).toBeVisible();
    expect(screen.getByText("준수하다")).toBeVisible();
    expect(screen.getByText("다시 볼 단어")).toBeVisible();
  });
});
