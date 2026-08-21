/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import type { AdminHistoryDetail } from "@/lib/services/admin-service";

import { AdminHistoryDetailContent } from "./admin-history-detail";

afterEach(cleanup);

function perQuestionDetail(): AdminHistoryDetail {
  const summary: AssignmentHistorySummary = {
    activityAt: "2026-08-22T00:00:00.000Z",
    assignedAt: "2026-08-22T00:00:00.000Z",
    assignmentDeleted: false,
    assignmentId: "assignment-1",
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    assignmentTitle: "문제별 시간 시험",
    attemptId: null,
    attemptNumber: null,
    availableFrom: null,
    availableUntil: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    datasetId: "dataset-1",
    datasetTitle: "테스트 단어장",
    deadlineAt: null,
    englishToKoreanRatio: 50,
    finalScore: null,
    gradeLabel: "고3",
    id: "assignment:assignment-1:student-1",
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
    questionTimeLimitSeconds: 20,
    retryCorrectCount: null,
    retryStartedAt: null,
    schoolName: "테스트고",
    startedAt: null,
    status: "not_started",
    studentDeleted: false,
    studentId: "student-1",
    studentName: "테스트 학생",
    studentStatus: "active",
    timeLimitSeconds: 10_800,
    timingMode: "per_question",
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    unresolvedWrongCount: null,
  };

  return {
    attempt: null,
    canonicalKey: "assignment.assignment-1.student-1",
    summary,
  };
}

describe("AdminHistoryDetailContent timing", () => {
  it("shows the per-question limit instead of the compatibility total cap", () => {
    render(<AdminHistoryDetailContent detail={perQuestionDetail()} />);

    expect(screen.getByText("20문항 · 문제당 20초 · 80점")).toBeVisible();
    expect(screen.queryByText(/180분/)).not.toBeInTheDocument();
  });
});
