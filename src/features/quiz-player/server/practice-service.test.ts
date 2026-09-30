import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), hydrate: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/features/students/public-server", () => ({ hydrateNotebookRows: mocks.hydrate }));
import { getPracticeHistory, previewPractice, startPractice } from "./practice-service";
import type { PracticeInput } from "../contracts/practice";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input: PracticeInput = { requestKey: id(1), selection: { mode: "selected", keys: ["word:a"] },
  settings: { questionCount: 1, englishToKoreanRatio: 100, timingMode: "none", timeLimitSeconds: null, questionTimeLimitSeconds: null } };
const receipt = { attempt: { id: id(2), assignmentTitle: "연습", quizContentMode: "book_meaning_choice", status: "in_progress", phase: "initial",
  startedAt: "2026-09-30T00:00:00Z", deadlineAt: "infinity", timerDeadlineAt: "infinity", timingMode: "none", questionTimeLimitSeconds: null,
  questions: [], currentQuestionId: null }, timerRemainingMilliseconds: 0 };

beforeEach(() => vi.resetAllMocks());
describe("자율연습 서버 조회와 재전송", () => {
  it.each([
    ["practice_source_changed", "40001", 409, "source_changed"],
    ["practice_range_too_large", "22023", 422, undefined],
    ["practice_student_unavailable", "42501", 403, undefined],
    ["connection interrupted", "08006", 503, undefined],
  ])("원천 조회 %s 오류를 명확히 구분한다", async (message, code, status, responseCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message, code } });
    await expect(previewPractice(id(3), input)).rejects.toMatchObject({ status, code: responseCode });
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it("시작 응답 유실 뒤에는 원천과 발음을 다시 읽기 전에 기존 회차를 반환한다", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await startPractice(id(3), { ...input, confirmation: "a".repeat(64) })).toEqual(receipt);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe("get_student_word_practice_v1");
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it("새 시작 준비 중 원천 변경도 같은 409 코드로 되돌린다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "practice_source_changed", code: "40001" } });
    await expect(startPractice(id(3), { ...input, confirmation: "a".repeat(64) })).rejects.toMatchObject({ status: 409, code: "source_changed" });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["get_student_word_practice_v1", "prepare_student_word_practice_v1"]);
  });
  it("확정 실패가 아닌 시작 결과 조회 장애는 503으로 남긴다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } });
    await expect(startPractice(id(3), { ...input, confirmation: "a".repeat(64) })).rejects.toMatchObject({ status: 503 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("내역의11번째는 다음 페이지 표시용이며 커서는10번째다", async () => {
    const rows = Array.from({ length: 11 }, (_, n) => ({ id: id(n + 20), startedAt: "2026-09-30T00:00:00.123456Z", finishedAt: null, questionCount: 1, correctCount: 0, status: "in_progress" }));
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    const page = await getPracticeHistory(id(3));
    expect(page.items).toHaveLength(10);
    expect(JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString())).toEqual({ studentId: id(3), at: rows[9].startedAt, id: rows[9].id });
    await getPracticeHistory(id(3), page.nextCursor);
    expect(mocks.rpc.mock.lastCall?.[1]).toMatchObject({ p_before_started_at: rows[9].startedAt, p_before_id: rows[9].id });
    await expect(getPracticeHistory(id(3), "bad-cursor")).rejects.toMatchObject({ status: 400 });
  });
  it("다른 계정의 다음 페이지는 조회하지 않고409로 새 문서 이동을 요청한다", async () => {
    const cursor = Buffer.from(JSON.stringify({ studentId: id(3), at: "2026-09-30T00:00:00Z", id: id(20) })).toString("base64url");
    await expect(getPracticeHistory(id(4), cursor)).rejects.toMatchObject({ status: 409, code: "student_changed" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
