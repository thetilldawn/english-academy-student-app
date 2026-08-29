import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({ rpc: mocks.rpc }),
}));

import {
  getStudentDashboardCompletedPage,
  getStudentDashboardInitial,
} from "./student-dashboard-query";
import { StudentDashboardReadError } from "./student-dashboard-read-error";
import { encodeStudentDashboardCursor, studentDashboardStudentFingerprint } from "../student-dashboard-cursor";

const studentId = "11111111-1111-4111-8111-111111111111";
const snapshotAt = "2026-08-29T00:00:00.000Z";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function rawItem(index: number, overrides: Record<string, unknown> = {}) {
  return {
    _dataset: {
      catalog: {
        academicYear: 2025,
        catalogGroup: "high_mock",
        curriculumRevision: null,
        displayName: "고3 모의고사 장문독해",
        editionLabel: null,
        gradeCode: "G12",
        isAssignable: true,
        materialKind: "exam_collection",
        publisher: null,
        seriesTitle: null,
        sortIndex: 1,
      },
      edition: null,
      title: "raw title",
    },
    assignedAt: "2026-08-01T00:00:00.000Z",
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    availableFrom: null,
    availableUntil: null,
    id: uuid(index),
    lastAttemptId: null,
    lastCompletedAt: null,
    lastDeadlineAt: null,
    lastFinalScore: null,
    lastInitialCompletedAt: null,
    lastInitialScore: null,
    lastPassed: null,
    lastPhase: null,
    lastRetryStartedAt: null,
    lastStartedAt: null,
    lastStatus: null,
    lastUnresolvedWrongCount: null,
    missedAt: null,
    passingScore: 80,
    primaryUnitLabels: [],
    primaryUnitSortIndexes: [],
    questionCount: 20,
    retakeAllowed: true,
    title: "고3 모의고사 장문독해 · 3월 19번",
    unitLabels: ["3월 19번"],
    unitSortIndexes: [19],
    ...overrides,
  };
}

function completedNode(index: number) {
  const completedAt = new Date(
    Date.parse("2026-08-28T00:00:00.000Z") - index * 60_000,
  ).toISOString();
  return {
    assignmentId: uuid(index),
    effectiveAt: completedAt,
    item: rawItem(index, {
      lastAttemptId: uuid(index + 100),
      lastCompletedAt: completedAt,
      lastFinalScore: 100,
      lastInitialCompletedAt: completedAt,
      lastInitialScore: 100,
      lastPassed: true,
      lastPhase: "completed",
      lastStartedAt: "2026-08-01T00:00:00.000Z",
      lastStatus: "completed",
    }),
  };
}

function initialRow() {
  return {
    completed_count: 11,
    completed_items: Array.from({ length: 11 }, (_, index) =>
      completedNode(index + 1)),
    current_items: [{
      assignmentId: uuid(50),
      dashboardSection: "open",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      item: rawItem(50, { lastDeadlineAt: "infinity" }),
    }],
    deadline_closed_count: 0,
    needs_attention_count: 0,
    open_count: 1,
    scheduled_count: 0,
    snapshot_at: snapshotAt,
  };
}

describe("student dashboard query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("초기 RPC 한 번을 화면 계약으로 바꾸고 완료 11번째로 커서를 만든다", async () => {
    mocks.rpc.mockResolvedValue({ data: [initialRow()], error: null });

    const result = await getStudentDashboardInitial({ studentId });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_student_dashboard_initial_v1",
      { p_snapshot_at: null, p_student_id: studentId },
    );
    expect(result.currentAssignments).toHaveLength(1);
    expect(result.currentAssignments[0]).toMatchObject({ section: "open" });
    expect(result.currentAssignments[0]?.assignment).toMatchObject({
      datasetTitle: "[2025] 고3 모의고사 장문독해",
      lastDeadlineAt: null,
      scopeLabel: "3월 19번",
    });
    expect(result.completedPage.items).toHaveLength(10);
    expect(result.completedPage.nextCursor).not.toBeNull();
    expect(result.sectionCounts.completed).toBe(11);
  });

  it.each([0, 1, 10])(
    "완료 %i건이면 표시한 자료 뒤에 불필요한 커서를 만들지 않는다",
    async (completedCount) => {
      const row = initialRow();
      row.completed_count = completedCount;
      row.completed_items = Array.from(
        { length: completedCount },
        (_, index) => completedNode(index + 1),
      );
      mocks.rpc.mockResolvedValue({ data: [row], error: null });

      const result = await getStudentDashboardInitial({ studentId });

      expect(result.completedPage.items).toHaveLength(completedCount);
      expect(result.completedPage.nextCursor).toBeNull();
    },
  );

  it("같은 학생 snapshot의 다음 완료 10+1건만 읽는다", async () => {
    const cursor = encodeStudentDashboardCursor({
      assignmentId: uuid(10),
      effectiveAt: "2026-08-18T00:00:00.000Z",
      snapshotAt,
      studentFingerprint: studentDashboardStudentFingerprint(studentId),
      version: 1,
    });
    mocks.rpc.mockResolvedValue({
      data: Array.from({ length: 11 }, (_, index) => {
        const node = completedNode(index + 20);
        return {
          cursor_assignment_id: node.assignmentId,
          cursor_effective_at: node.effectiveAt,
          item: node.item,
        };
      }),
      error: null,
    });

    const page = await getStudentDashboardCompletedPage(cursor, { studentId });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_student_dashboard_completed_page_v1",
      expect.objectContaining({
        p_cursor_assignment_id: uuid(10),
        p_snapshot_at: snapshotAt,
        p_student_id: studentId,
      }),
    );
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).not.toBeNull();
  });

  it("구역 개수 불일치와 DB 오류를 빈 화면으로 바꾸지 않는다", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ ...initialRow(), open_count: 2 }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "db" } });

    await expect(getStudentDashboardInitial({ studentId }))
      .rejects.toThrow(StudentDashboardReadError);
    await expect(getStudentDashboardInitial({ studentId }))
      .rejects.toThrow("학생 시험 목록을 불러오지 못했습니다.");
  });
});
