// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("keeps first completion, retry, missed, and failed filters disjoint", async () => {
    const user = userEvent.setup();
    render(
      <AdminHistoryList
        items={[
          historyItem("첫 완료", {
            completedAt: "2026-08-09T00:00:00.000Z",
            finalScore: 100,
            phase: "completed",
            status: "completed",
          }),
          historyItem("재시험 성공", {
            completedAt: "2026-08-10T00:00:00.000Z",
            finalScore: 100,
            phase: "completed",
            retryStartedAt: "2026-08-09T12:00:00.000Z",
            status: "completed",
          }),
          historyItem("재시험 실패", {
            completedAt: "2026-08-11T00:00:00.000Z",
            finalScore: 50,
            phase: "completed",
            retryStartedAt: "2026-08-10T12:00:00.000Z",
            status: "completed",
          }),
          historyItem("재시험 진행", {
            phase: "retry",
            retryStartedAt: "2026-08-11T12:00:00.000Z",
            status: "in_progress",
          }),
          historyItem("미응시", {
            missedAt: "2026-08-12T00:00:00.000Z",
            status: "missed",
          }),
          historyItem("첫 미통과", {
            completedAt: "2026-08-13T00:00:00.000Z",
            finalScore: 50,
            phase: "completed",
            status: "completed",
          }),
        ]}
        showFilters
      />,
    );
    const status = screen.getByLabelText("상태");

    await user.selectOptions(status, "completed");
    expect(screen.getByRole("link", { name: /첫 완료.*상세/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /재시험 성공.*상세/ })).not.toBeInTheDocument();

    await user.selectOptions(status, "retried");
    expect(
      screen.getByRole("heading", { level: 2, name: "재시험" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /재시험 성공.*상세/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /재시험 실패.*상세/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /재시험 진행.*상세/ })).toBeVisible();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("aria-label")),
    ).toEqual([
      "재시험 진행 재시험 진행 상세",
      "재시험 실패 재시험 실패 상세",
      "재시험 성공 재시험 성공 상세",
    ]);
    expect(screen.queryByRole("link", { name: /첫 완료.*상세/ })).not.toBeInTheDocument();

    await user.selectOptions(status, "missed");
    expect(screen.getByRole("heading", { level: 2, name: "미응시" })).toBeVisible();
    expect(screen.getByRole("link", { name: /미응시.*상세/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /첫 미통과.*상세/ })).not.toBeInTheDocument();

    await user.selectOptions(status, "needs_attention");
    expect(screen.getByRole("heading", { level: 2, name: "미통과" })).toBeVisible();
    expect(screen.getByRole("link", { name: /첫 미통과.*상세/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /미응시.*상세/ })).not.toBeInTheDocument();
  });
});
