import { beforeEach, describe, expect, it, vi } from "vitest";
import { resultRecordFixture, resultRecordWire } from "@/test-support/vocabulary-result-fixture";

const mocks = vi.hoisted(() => ({
  getAttemptQuestionResults: vi.fn(),
  maybeSingle: vi.fn(),
  getRecord: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: vi.fn(),
}));
vi.mock("@/features/results/public-server", () => ({ getVocabularyResultRecord: mocks.getRecord }));
vi.mock("@/lib/services/quiz/attempt-result-query", () => ({
  getAttemptQuestionResults: mocks.getAttemptQuestionResults,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import { getAdminAttemptDetail } from "./admin-attempt-detail-query";

const admin = { displayName: "관리자", userId: "admin-id" };

describe("admin attempt detail read service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAttemptQuestionResults.mockResolvedValue([]);
    mocks.getRecord.mockResolvedValue(resultRecordFixture());
  });

  it("DB 오류와 실제 미존재를 구분한다", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(getAdminAttemptDetail("attempt-id", admin)).rejects.toThrow(
      "응시 상세를 불러오지 못했습니다.",
    );
    await expect(getAdminAttemptDetail("attempt-id", admin)).resolves.toBeNull();
  });
  it("조회 사이 재시험이 끝나도 최신 판의 상태·날짜·96점을 함께 표시한다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "attempt-id", status: "in_progress", phase: "review", final_score: null,
      students: { display_name: "가짜 학생", deleted_at: null }, assignments: { title: "가짜 시험", deleted_at: null, quiz_content_mode: "book_meaning_choice" } }, error: null });
    expect(await getAdminAttemptDetail("attempt-id", admin)).toMatchObject({ status: "completed", phase: "completed", questionCount: 50,
      initialCorrectCount: 40, retryCorrectCount: 8, unresolvedWrongCount: 2, initialScore: 80, finalScore: 96, passed: true,
      completedAt: "2026-10-02T01:08:00+00:00" });
    expect(mocks.getAttemptQuestionResults).toHaveBeenCalledWith("attempt-id", { kind: "admin", adminId: admin.userId }, "initial_mistakes");
  });
  it("진행 중 재시험의 정답1·미해결1을 아직 없는 최종 요약으로 덮지 않는다", async () => {
    const wire = resultRecordWire({state: "retry_in_progress", finalized: false, finalizedAt: null, finalReason: null});
    wire.phases = [{...wire.phases[0], target_count: 4, correct_count: 2, wrong_count: 2, score: 50}];
    Object.assign(wire.attempt, {questionCount: 4, initialCorrectCount: 2, initialScore: 50, retryCorrectCount: 1, unresolvedWrongCount: 1});
    mocks.getRecord.mockResolvedValue(resultRecordFixture(wire));
    mocks.maybeSingle.mockResolvedValue({data: {id: "attempt-id", students: null, assignments: null}, error: null});
    expect(await getAdminAttemptDetail("attempt-id", admin)).toMatchObject({status: "in_progress", phase: "retry",
      initialCorrectCount: 2, retryCorrectCount: 1, unresolvedWrongCount: 1, finalScore: null, passed: null});
  });
  it("요약 조회 실패를 상세0건으로 삼키지 않는다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "attempt-id" }, error: null });
    mocks.getRecord.mockRejectedValue(new Error("시험 결과를 불러오지 못했습니다."));
    await expect(getAdminAttemptDetail("attempt-id", admin)).rejects.toThrow("시험 결과를 불러오지 못했습니다.");
    expect(mocks.getAttemptQuestionResults).not.toHaveBeenCalled();
  });
});
