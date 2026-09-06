import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ from: mocks.from }) }));
import { getStudyExamplePrompts } from "./assignment-study-example-query";
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["from", "select", "eq", "in"] as const) mocks[name].mockReturnValue(mocks);
  mocks.limit.mockResolvedValue({ data: [{ vocab_entry_id: 7, prompt: "She _____ the letters." }], error: null });
});
describe("허용된 배정의 예문 위치 자료 묶음 읽기", () => {
  it("같은 배정·예문형·허용된 단어만 두 필드로 한 번 조회한다", async () => {
    expect(await getStudyExamplePrompts("assignment", [7, 7])).toEqual(new Map([[7, ["She _____ the letters."]]]));
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("assignment_questions");
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("vocab_entry_id, prompt");
    expect(mocks.eq.mock.calls).toEqual([["assignment_id", "assignment"], ["eligibility_quiz_mode", "canonical_example_to_headword"]]);
    expect(mocks.in).toHaveBeenCalledExactlyOnceWith("vocab_entry_id", [7]);
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(1001);
  });
  it("허용 단어가 없으면 요청하지 않으며 빈 응답과 장애를 구분한다", async () => {
    expect(await getStudyExamplePrompts("assignment", [])).toEqual(new Map());
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce({ data: [], error: null });
    expect(await getStudyExamplePrompts("assignment", [7])).toEqual(new Map());
    mocks.limit.mockResolvedValueOnce({ data: null, error: { code: "timeout", message: "private SQL" } });
    await expect(getStudyExamplePrompts("assignment", [7])).rejects.toThrow("assignment_study_example_read_failed");
  });
  it.each([null, [{ vocab_entry_id: 8, prompt: "_____" }], [{ vocab_entry_id: 7, prompt: "" }], Array.from({ length: 1001 }, () => ({ vocab_entry_id: 7, prompt: "_____" }))])("오염·잘못된 필드·상한 초과를 허용하지 않는다", async (data) => {
    mocks.limit.mockResolvedValueOnce({ data, error: null });
    await expect(getStudyExamplePrompts("assignment", [7])).rejects.toThrow("assignment_study_example_data_invalid");
  });
});
