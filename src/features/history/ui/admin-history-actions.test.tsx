// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationProvider } from "@/design-system/patterns/confirmation/confirmation";
import { installNativeOverlayFixture } from "@/test-support/native-overlay-fixture";
import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { cancelStudentAssignment } from "../api/history-mutations";
import { AdminHistoryActions } from "./admin-history-actions";

vi.mock("../api/history-mutations", () => ({ cancelStudentAssignment: vi.fn(() => new Promise(() => {})) }));
vi.mock("../actions/hide-admin-history-entry", () => ({ hideAdminHistoryEntry: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
installNativeOverlayFixture();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function summary(assignmentId: string): AssignmentHistorySummary {
  return {
    activityAt: "2026-09-08T00:00:00.000Z", assignedAt: "2026-09-08T00:00:00.000Z",
    assignmentDeleted: false, assignmentId, assignmentPurpose: "regular", assignmentStatus: "active",
    assignmentTitle: "가짜 시험", attemptId: null, attemptNumber: 0, availableFrom: null, availableUntil: null,
    cancellationReason: null, cancelledAt: null, completedAt: null, datasetId: "dataset-1", datasetTitle: "가짜 단어장",
    deadlineAt: null, englishToKoreanRatio: 100, finalScore: null, gradeLabel: "고1", id: assignmentId,
    initialCompletedAt: null, initialCorrectCount: null, initialScore: null, missedAt: null, passed: null,
    passingScore: 80, phase: null, primaryUnitIds: ["unit-1"], primaryUnitLabels: ["DAY 01"], questionCount: 4,
    questionOrderMode: "random", retryCorrectCount: null, retryStartedAt: null, schoolName: "가짜고",
    startedAt: null, status: "not_started", studentDeleted: false, studentId: "student-1", studentName: "가짜 학생",
    studentStatus: "active", timeLimitSeconds: 300, timingMode: "total", questionTimeLimitSeconds: null,
    unitIds: ["unit-1"], unitLabels: ["DAY 01"], unresolvedWrongCount: 0,
  };
}
const view = (id: string) => <ConfirmationProvider><AdminHistoryActions item={summary(id)} showDetailLink={false} /></ConfirmationProvider>;

describe("내역 변경 확인의 대상 수명", () => {
  it("질문 도중 대상을 바꾸면 취소하고 새 대상 버튼을 잠그지 않는다", async () => {
    const { rerender } = render(view("first"));
    fireEvent.click(screen.getByRole("button", { name: "배정 취소" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    rerender(view("second"));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "배정 취소" })).toBeEnabled();
    expect(cancelStudentAssignment).not.toHaveBeenCalled();
  });

  it("확인 직후 닫힌 화면에서는 늦은 승인이 변경을 전송하지 않는다", async () => {
    const { unmount } = render(view("first"));
    fireEvent.click(screen.getByRole("button", { name: "배정 취소" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "확인" }));
      unmount();
    });
    expect(cancelStudentAssignment).not.toHaveBeenCalled();
  });

  it("확인 전에는 전송하지 않고 승인 뒤에도 한 번만 전송한다", async () => {
    render(view("first"));
    const cancel = screen.getByRole("button", { name: "배정 취소" });
    fireEvent.click(cancel);
    fireEvent.click(cancel);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(cancelStudentAssignment).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "확인" })));
    expect(cancelStudentAssignment).toHaveBeenCalledOnce();
    expect(cancelStudentAssignment).toHaveBeenCalledWith("first", "student-1", expect.any(String));
  });
});
