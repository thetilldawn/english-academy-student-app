import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  getAdminAttemptDetail: vi.fn(),
  getAdminAttemptPointSummary: vi.fn(),
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("./admin-attempt-detail-query", () => ({
  getAdminAttemptDetail: mocks.getAdminAttemptDetail,
}));
vi.mock("@/lib/services/learning-point-read-service", () => ({
  getAdminAttemptPointSummary: mocks.getAdminAttemptPointSummary,
}));

import { getAdminHistoryReadModelDetail } from "./admin-history-detail-query";

const assignmentId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const datasetId = "30000000-0000-4000-8000-000000000001";
const studentId = "40000000-0000-4000-8000-000000000001";
const unitId = "50000000-0000-4000-8000-000000000001";
const recordedAt = "2026-08-29T00:00:00.000Z";

function rawDetail(currentAttemptId: string | null) {
  return {
    _dataset: {
      catalog: null,
      edition: null,
      title: "테스트 단어장",
    },
    activityAt: recordedAt,
    assignedAt: recordedAt,
    assignmentDeleted: false,
    assignmentId,
    assignmentPurpose: "regular",
    assignmentStatus: "active",
    assignmentTitle: "테스트 시험",
    attemptId: currentAttemptId,
    attemptNumber: currentAttemptId ? 1 : null,
    availableFrom: null,
    availableUntil: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    datasetId,
    datasetTitle: "테스트 단어장",
    deadlineAt: null,
    englishToKoreanRatio: 100,
    finalScore: null,
    gradeLabel: "고3",
    id: currentAttemptId ?? `assignment:${assignmentId}:${studentId}`,
    initialCompletedAt: null,
    initialCorrectCount: null,
    initialScore: null,
    missedAt: null,
    passed: null,
    passingScore: 80,
    phase: currentAttemptId ? "initial" : null,
    primaryUnitIds: [unitId],
    primaryUnitLabels: ["DAY 01"],
    primaryUnitSortIndexes: [1],
    questionCount: 20,
    questionOrderMode: "fixed",
    questionTimeLimitSeconds: null,
    retryCorrectCount: null,
    retryStartedAt: null,
    schoolName: "테스트고",
    startedAt: currentAttemptId ? recordedAt : null,
    status: currentAttemptId ? "in_progress" : "not_started",
    studentDeleted: false,
    studentId,
    studentName: "테스트 학생",
    studentStatus: "active",
    timeLimitSeconds: 60,
    timingMode: "total",
    unitIds: [unitId],
    unitLabels: ["DAY 01"],
    unitSortIndexes: [1],
    unresolvedWrongCount: null,
  };
}

describe("admin history detail query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      displayName: "관리자",
      userId: "admin-id",
    });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("배정 주소는 해당 학생의 직접 상세만 읽는다", async () => {
    mocks.rpc.mockResolvedValue({ data: rawDetail(null), error: null });

    const detail = await getAdminHistoryReadModelDetail(
      `assignment.${assignmentId}.${studentId}`,
    );

    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_history_detail_v1", {
      p_assignment_id: assignmentId,
      p_attempt_id: null,
      p_student_id: studentId,
    });
    expect(detail?.canonicalKey).toBe(
      `assignment.${assignmentId}.${studentId}`,
    );
    expect(detail?.attempt).toBeNull();
    expect(mocks.getAdminAttemptDetail).not.toHaveBeenCalled();
  });

  it("응시 주소는 상세·포인트를 같은 관리자 확인으로 조합한다", async () => {
    const admin = { displayName: "관리자", userId: "admin-id" };
    const attempt = { id: attemptId };
    const pointSummary = { currentPoints: 10 };
    mocks.requireAdmin.mockResolvedValue(admin);
    mocks.rpc.mockResolvedValue({ data: rawDetail(attemptId), error: null });
    mocks.getAdminAttemptDetail.mockResolvedValue(attempt);
    mocks.getAdminAttemptPointSummary.mockResolvedValue(pointSummary);

    const detail = await getAdminHistoryReadModelDetail(`attempt.${attemptId}`);

    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_history_detail_v1", {
      p_assignment_id: null,
      p_attempt_id: attemptId,
      p_student_id: null,
    });
    expect(mocks.getAdminAttemptDetail).toHaveBeenCalledWith(attemptId, admin);
    expect(mocks.getAdminAttemptPointSummary).toHaveBeenCalledWith(
      studentId,
      attemptId,
    );
    expect(detail).toMatchObject({
      attempt,
      canonicalKey: `attempt.${attemptId}`,
      pointSummary,
    });
  });

  it("상세에서도 시간 제한 없는 DB 마감 값을 null로 바꾼다", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...rawDetail(null), deadlineAt: "infinity" },
      error: null,
    });

    const detail = await getAdminHistoryReadModelDetail(
      `assignment.${assignmentId}.${studentId}`,
    );

    expect(detail?.summary.deadlineAt).toBeNull();
  });

  it("잘못된 주소와 DB 오류를 구분한다", async () => {
    await expect(getAdminHistoryReadModelDetail("invalid-key")).resolves.toBeNull();
    expect(mocks.requireAdmin).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValue({ data: null, error: { message: "failed" } });
    await expect(
      getAdminHistoryReadModelDetail(`attempt.${attemptId}`),
    ).rejects.toThrow("시험 내역 상세를 불러오지 못했습니다.");
  });
});
