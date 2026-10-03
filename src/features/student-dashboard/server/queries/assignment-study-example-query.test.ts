import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), limit: vi.fn(), contents: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ from: mocks.from }) }));
vi.mock("@/features/quiz-player/public-server-queries", () => ({ getTransitionStudyContents: mocks.contents }));
import { getStudyExamplePrompts } from "./assignment-study-example-query";
const id = (n: number) => `b1040000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = { id: id(3), vocab_entry_id: 7, prompt: "She _____ the letters." };
beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ["from", "select", "eq", "in"] as const) mocks[name].mockReturnValue(mocks);
  mocks.limit.mockResolvedValue({ data: [row], error: null });
});
describe("운영 전환 중 배정 예문 읽기", () => {
  it("기존 본문은 추가 RPC 없이 허용된 배정과 단어만 조회한다", async () => {
    expect(await getStudyExamplePrompts(id(1), id(2), [7, 7])).toEqual(new Map([[7, [row.prompt]]]));
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("id, vocab_entry_id, prompt");
    expect(mocks.eq.mock.calls).toEqual([["assignment_id", id(2)], ["eligibility_quiz_mode", "canonical_example_to_headword"]]);
    expect(mocks.in).toHaveBeenCalledExactlyOnceWith("vocab_entry_id", [7]);
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(1001);
    expect(mocks.contents).not.toHaveBeenCalled();
  });
  it("혼합 배정의 NULL 본문만 학생과 배정에 묶어 읽고 순서를 보존한다", async () => {
    mocks.limit.mockResolvedValue({ data: [row, { ...row, id: id(4), prompt: null }], error: null });
    mocks.contents.mockResolvedValue(new Map([[id(4), { ...row, id: id(4), prompt: "Fixed _____ stays." }]]));
    expect(await getStudyExamplePrompts(id(1), id(2), [7])).toEqual(new Map([[7, [row.prompt, "Fixed _____ stays."]]]));
    expect(mocks.contents).toHaveBeenCalledExactlyOnceWith(id(1), id(2), [id(4)]);
  });
  it("빈 범위는 무호출이며 빈 응답과 오류를 구분한다", async () => {
    expect(await getStudyExamplePrompts(id(1), id(2), [])).toEqual(new Map());
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce({ data: [], error: null });
    expect(await getStudyExamplePrompts(id(1), id(2), [7])).toEqual(new Map());
    mocks.limit.mockResolvedValueOnce({ data: null, error: { code: "timeout" } });
    await expect(getStudyExamplePrompts(id(1), id(2), [7])).rejects.toThrow("assignment_study_example_read_failed");
  });
  it.each([null, [{ ...row, vocab_entry_id: 8 }], [{ ...row, prompt: "" }], [{ ...row, prompt: undefined }], [row, row], Array.from({ length: 1001 }, () => row)])("오염·누락·중복·상한 초과를 복원하지 않는다", async data => {
    mocks.limit.mockResolvedValueOnce({ data, error: null });
    await expect(getStudyExamplePrompts(id(1), id(2), [7])).rejects.toThrow("assignment_study_example_data_invalid");
    expect(mocks.contents).not.toHaveBeenCalled();
  });
  it.each([new Map(), new Map([[id(3), { ...row, vocab_entry_id: 8 }]]), new Map([[id(3), { ...row, prompt: "" }]])])("복원도 원래 단어와 유효한 본문을 요구한다", async content => {
    mocks.limit.mockResolvedValue({ data: [{ ...row, prompt: null }], error: null });
    mocks.contents.mockResolvedValue(content);
    await expect(getStudyExamplePrompts(id(1), id(2), [7])).rejects.toThrow("assignment_study_example_data_invalid");
  });
  it("권한 거절을 빈 예문이나 현재 사전으로 대체하지 않는다", async () => {
    mocks.limit.mockResolvedValue({ data: [{ ...row, prompt: null }], error: null });
    mocks.contents.mockRejectedValue(new Error("denied"));
    await expect(getStudyExamplePrompts(id(1), id(2), [7])).rejects.toThrow("denied");
    expect(mocks.from).toHaveBeenCalledOnce();
  });
});
