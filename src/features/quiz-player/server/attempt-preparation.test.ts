import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), contents: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("./queries/question-content-query", async importOriginal => ({ ...await importOriginal<typeof import("./queries/question-content-query")>(), getPreparationQuestionContents: mocks.contents }));
import { QuestionContentPreparationChangedError } from "./queries/question-content-query";
import { getQuizPreparation, QuizPreparationChangedError } from "./attempt-preparation";
const id = (n: number) => `a2040000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValueOnce({ error: null, data: { id: id(1), kind: "initial", begunId: null,
    assignment: { id: id(2), title: "가짜 시험", quiz_content_mode: "book_meaning_choice", timing_mode: "none", question_time_limit_seconds: null },
    plan: [{ id: id(3), assignment_question_id: id(4), vocab_entry_id: 1, order_index: 1, direction: "english_to_korean",
      prompt: "word", choices: ["뜻", "둘", "셋", "넷"], correct_choice_index: 0 }] } });
});
it("본문을 읽기 전에 다른 탭이 시작하면 기존 응시 영수증으로 복구한다", async () => {
  mocks.contents.mockRejectedValue(new QuestionContentPreparationChangedError("preparation_changed"));
  mocks.rpc.mockResolvedValueOnce({ error: null, data: { id: id(1), kind: "initial", begunId: id(5) } });
  expect(await getQuizPreparation(id(6), id(1))).toEqual({ resumeId: id(5), kind: "initial" });
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["get_quiz_preparation_v1", "get_quiz_preparation_v1"]);
});
it("깨진 본문 참조는 기존 영수증 재조회로 숨기지 않는다", async () => {
  mocks.contents.mockRejectedValue(new Error("question_content_binding_mismatch"));
  await expect(getQuizPreparation(id(6), id(1))).rejects.toThrow("question_content_binding_mismatch");
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
it.each([null,{kind:'initial',begunId:null}])('본문 조회 사이 만료된 준비는 확정된 재준비 오류로 돌려준다 (%j)',async refreshed=>{
  mocks.contents.mockRejectedValue(new QuestionContentPreparationChangedError('preparation_unavailable'));
  mocks.rpc.mockResolvedValueOnce({error:null,data:refreshed});
  await expect(getQuizPreparation(id(6),id(1))).rejects.toBeInstanceOf(QuizPreparationChangedError);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
