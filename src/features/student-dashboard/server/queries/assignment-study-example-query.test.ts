import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), limit: vi.fn(), contents: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ from: mocks.from }) }));
vi.mock("@/features/quiz-player/public-server-queries", () => ({ getAssignmentStudyQuestionContents: mocks.contents }));
import { getStudyExamplePrompts } from "./assignment-study-example-query";
const question = "a2070000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ["from", "select", "eq", "in"] as const) mocks[name].mockReturnValue(mocks);
  mocks.limit.mockResolvedValue({ data: [{ id: question, vocab_entry_id: 7 }], error: null });
  mocks.contents.mockResolvedValue(new Map([[question, { id: question, vocab_entry_id: 7, prompt: "She _____ the letters." }]]));
});
describe("허용된 배정의 예문 위치 자료 묶음 읽기", () => {
  it("같은 배정·예문형·허용된 단어만 두 필드로 한 번 조회한다", async () => {
    expect(await getStudyExamplePrompts("student", "assignment", [7, 7])).toEqual(new Map([[7, ["She _____ the letters."]]]));
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("assignment_questions");
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("id, vocab_entry_id");
    expect(mocks.contents).toHaveBeenCalledExactlyOnceWith("student", "assignment", [question]);
    expect(mocks.eq.mock.calls).toEqual([["assignment_id", "assignment"], ["eligibility_quiz_mode", "canonical_example_to_headword"]]);
    expect(mocks.in).toHaveBeenCalledExactlyOnceWith("vocab_entry_id", [7]);
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(1001);
  });
  it("허용 단어가 없으면 요청하지 않으며 빈 응답과 장애를 구분한다", async () => {
    expect(await getStudyExamplePrompts("student", "assignment", [])).toEqual(new Map());
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce({ data: [], error: null });
    expect(await getStudyExamplePrompts("student", "assignment", [7])).toEqual(new Map());
    mocks.limit.mockResolvedValueOnce({ data: null, error: { code: "timeout", message: "private SQL" } });
    await expect(getStudyExamplePrompts("student", "assignment", [7])).rejects.toThrow("assignment_study_example_read_failed");
  });
  it.each([null, [{ id: question, vocab_entry_id: 8 }], [{ id: "bad", vocab_entry_id: 7 }], Array.from({ length: 1001 }, () => ({ id: question, vocab_entry_id: 7 }))])("오염·잘못된 필드·상한 초과를 허용하지 않는다", async (data) => {
    mocks.limit.mockResolvedValueOnce({ data, error: null });
    await expect(getStudyExamplePrompts("student", "assignment", [7])).rejects.toThrow("assignment_study_example_data_invalid");
    expect(mocks.contents).not.toHaveBeenCalled();
  });
  it("복원된 본문도 빈 예문이나 다른 단어로 바뀌지 않는다", async () => {
    mocks.contents.mockResolvedValueOnce(new Map([[question, { id: question, vocab_entry_id: 7, prompt: "" }]]))
      .mockResolvedValueOnce(new Map([[question, { id: question, vocab_entry_id: 8, prompt: "Different _____" }]]));
    await expect(getStudyExamplePrompts("student", "assignment", [7])).rejects.toThrow("assignment_study_example_data_invalid");
    await expect(getStudyExamplePrompts("student", "assignment", [7])).rejects.toThrow("assignment_study_example_data_invalid");
  });
});
