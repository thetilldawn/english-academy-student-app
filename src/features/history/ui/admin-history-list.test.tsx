// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AssignmentHistorySummary } from "@/lib/admin/history";

import { AdminHistoryList } from "./admin-history-list";

afterEach(cleanup);

function historyItem(
  id: string,
  overrides: Partial<AssignmentHistorySummary> = {},
): AssignmentHistorySummary {
  return {
    activityAt: "2026-08-08T00:00:00.000Z",
    assignedAt: "2026-08-08T00:00:00.000Z",
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
    datasetTitle: "테스트 단어장",
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
    retryCorrectCount: null,
    retryStartedAt: null,
    schoolName: "테스트고",
    startedAt: null,
    status: "not_started",
    studentDeleted: false,
    studentId: `student-${id}`,
    studentName: id,
    studentStatus: "active",
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    unitIds: ["unit-1"],
    unitLabels: ["DAY 01"],
    unresolvedWrongCount: null,
    ...overrides,
  };
}

describe("AdminHistoryList", () => {
  it("renders status sections in the approved order", () => {
    render(
      <AdminHistoryList
        items={[
          historyItem("완료 항목", {
            completedAt: "2026-08-09T00:00:00.000Z",
            finalScore: 100,
            status: "completed",
          }),
          historyItem("취소 항목", {
            cancelledAt: "2026-08-10T00:00:00.000Z",
            status: "cancelled",
          }),
          historyItem("미통과 항목", {
            completedAt: "2026-08-08T00:00:00.000Z",
            finalScore: 50,
            status: "completed",
          }),
          historyItem("응시 전 항목"),
        ]}
      />,
    );

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent),
    ).toEqual(["응시 전", "미응시 · 미통과", "완료", "취소 · 삭제"]);
  });
});
