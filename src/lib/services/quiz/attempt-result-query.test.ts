import { beforeEach, describe, expect, it, vi } from "vitest";
import { resultRecordFixture, resultRecordWire } from "@/test-support/vocabulary-result-fixture";

const mocks = vi.hoisted(() => ({
  getPointSummary: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  getRecord: vi.fn(),
  order: vi.fn(),
  or: vi.fn(),
}));
vi.mock("@/features/results/public-server", () => ({ getVocabularyResultRecord: mocks.getRecord }));
vi.mock("@/features/quiz-player/public-server-queries", () => ({ getAttemptQuestionContents: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("./pronunciation-registry", () => Object.fromEntries([
  "loadActiveVocabPronunciationReleaseRegistry", "loadEntryApprovedKoreanPronunciationRegistry", "loadEntrySourcePronunciationRegistry",
  "loadApprovedKoreanPronunciationRegistry", "loadSyntheticPronunciationRegistry", "loadVocabPronunciationRegistry", "loadPronunciationAudioCorrections",
].map(key => [key, vi.fn().mockResolvedValue(new Map())])));

vi.mock("@/lib/services/learning-point-read-service", () => ({
  getStudentAttemptPointSummary: mocks.getPointSummary,
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceSupabaseClient: () => ({ from: mocks.from }),
}));

import { getAttemptResult } from "./attempt-result-query";

describe("getAttemptResult ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = {
      eq: vi.fn(),
      maybeSingle: mocks.maybeSingle,
      select: vi.fn(),
      or: mocks.or,
      order: mocks.order,
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    mocks.or.mockReturnValue(chain);
    mocks.order.mockResolvedValue({ data: [], error: null });
    mocks.getRecord.mockResolvedValue(resultRecordFixture());
    mocks.getPointSummary.mockResolvedValue(null);
    mocks.from.mockReturnValue(chain);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it("does not read questions or points for another student's attempt", async () => {
    expect(
      await getAttemptResult("student-a", "attempt-owned-by-b"),
    ).toBeNull();

    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("quiz_attempts");
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });

  it.each(["57014", "PGRST000"])("DB %s 장애를 없는 결과로 바꾸지 않는다", async (code) => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "private server detail" } });
    await expect(getAttemptResult("student-a", "attempt-a")).rejects.toThrow("시험 결과를 불러오지 못했습니다.");
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });

  it("통신 예외도 404용 null로 삼키지 않는다", async () => {
    mocks.maybeSingle.mockRejectedValue(new Error("offline"));
    await expect(getAttemptResult("student-a", "attempt-a")).rejects.toThrow();
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });
  it("작은 오답 배열로 전체 점수를 다시 계산하지 않고 같은 결과판의96점을 쓴다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "attempt-id", status: "in_progress", phase: "review", final_score: null,
      assignments: { title: "가짜 시험", quiz_content_mode: "book_meaning_choice" } }, error: null });
    const value = await getAttemptResult("student-a", "attempt-id");
    expect(value).toMatchObject({ status: "completed", phase: "completed", questionCount: 50, initialCorrectCount: 40,
      retryCorrectCount: 8, unresolvedWrongCount: 2, initialScore: 80, finalScore: 96, passed: true, completedAt: "2026-10-02T01:08:00+00:00" });
    expect(mocks.or).toHaveBeenCalledExactlyOnceWith("initial_is_correct.is.null,initial_is_correct.eq.false");
  });
  it("진행 중 재시험의 정답1·미해결1을 같은 응시 시점 그대로 유지한다", async () => {
    const wire = resultRecordWire({state: "retry_in_progress", finalized: false, finalizedAt: null, finalReason: null});
    wire.phases = [{...wire.phases[0], target_count: 4, correct_count: 2, wrong_count: 2, score: 50}];
    Object.assign(wire.attempt, {questionCount: 4, initialCorrectCount: 2, initialScore: 50, retryCorrectCount: 1, unresolvedWrongCount: 1});
    mocks.getRecord.mockResolvedValue(resultRecordFixture(wire));
    mocks.maybeSingle.mockResolvedValue({data: {id: "attempt-id", assignments: null}, error: null});
    expect(await getAttemptResult("student-a", "attempt-id")).toMatchObject({status: "in_progress", phase: "retry",
      initialCorrectCount: 2, retryCorrectCount: 1, unresolvedWrongCount: 1, finalScore: null, passed: null});
  });
  it("상세 미보관은 문항이나 본문을 조회하지 않고 공식 요약만 쓴다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "attempt-id", assignments: null }, error: null });
    mocks.getRecord.mockResolvedValue(resultRecordFixture({ detailScope: "summary_only" }));
    expect(await getAttemptResult("student-a", "attempt-id")).toMatchObject({ questions: [], finalScore: 96 });
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.or).not.toHaveBeenCalled();
  });
  it("요약 권한 재확인 실패나 오류 뒤에는 문항과 포인트를 읽지 않는다", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "attempt-id" }, error: null });
    mocks.getRecord.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("시험 결과를 불러오지 못했습니다."));
    expect(await getAttemptResult("student-a", "attempt-id")).toBeNull();
    await expect(getAttemptResult("student-a", "attempt-id")).rejects.toThrow("시험 결과를 불러오지 못했습니다.");
    expect(mocks.from.mock.calls.every(([table]) => table === "quiz_attempts")).toBe(true);
    expect(mocks.getPointSummary).not.toHaveBeenCalled();
  });
});
