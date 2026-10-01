import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => mocks }));
import { getAttemptQuestionContents, getPreparationQuestionContents, getAssignmentStudyQuestionContents,
  QuestionContentPreparationChangedError } from "./question-content-query";
const id = (n: number) => `a2030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const body = (key: string) => ({ id: key, prompt: "frozen", choices: ["당시 뜻", "보기2", "보기3", "보기4"], assignment_question: null });
const envelope = (context: string, items: unknown[]) => ({ schemaVersion: "question-content-read-v1", context, items });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: envelope(args.p_context, args.p_question_ids.map(body)), error: null }));
});
describe("권한 문맥을 사용하는 공용 문항 조회", () => {
  it("201개를 200개씩 묶고 같은 ID는 한 번만 요청한다", async () => {
    const ids = Array.from({ length: 201 }, (_, n) => id(n + 10));
    const result = await getAttemptQuestionContents({ kind: "student", studentId: id(1) }, id(2), [...ids, ids[0]]);
    expect(result.size).toBe(201);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_question_ids.length)).toEqual([200, 1]);
    expect(mocks.rpc.mock.calls[0]).toEqual(["read_question_contents_v1", { p_context: "student_attempt", p_actor_id: id(1), p_context_id: id(2), p_question_ids: ids.slice(0, 200) }]);
    expect(await getAttemptQuestionContents({ kind: "admin", adminId: id(3) }, id(2), [])).toEqual(new Map());
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([
    envelope("admin_attempt", [body(id(10))]), envelope("student_attempt", []),
    envelope("student_attempt", [body(id(11))]), envelope("student_attempt", [body(id(10)), body(id(10))]),
    envelope("student_attempt", [{ ...body(id(10)), choices: null }]),
    envelope("student_attempt", [{ ...body(id(10)), correct_choice_index: 0 }]),
  ])("누락·다른 문맥·다른 ID·정답 필드가 섞인 응답을 거절한다", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getAttemptQuestionContents({ kind: "student", studentId: id(1) }, id(2), [id(10)])).rejects.toThrow("question_content_response_invalid");
  });
  it("사전과 출현의 문자형 키 및 당시 발음값을 보존한다", async () => {
    const exam = { release_id: id(4), occurrence_id: "occ:fake:1", dictionary_id: "word:fake", pronunciation_variant_id: "mw:fake",
      headword_snapshot: "past", primary_meaning_snapshot: "당시 뜻", display_pronunciation_ko_snapshot: "패스트", pronunciation_snapshot: {},
      choice_dictionary_snapshots: [], provenance_status: "reviewed_for_preview_v1" };
    const assignment = { vocab_entry_id: 10, choice_vocab_entry_ids: [10, 11, 12, 13], headword_snapshot: "past", primary_meaning_snapshot: "당시 뜻",
      provenance_status: "legacy_backfill", composition_pronunciation_snapshot: null, notebook_pronunciation_snapshot: null, exam_use_snapshot: exam };
    mocks.rpc.mockResolvedValue({ data: envelope("student_preparation", [{ id: id(10), assignment_question: assignment }]), error: null });
    expect((await getPreparationQuestionContents(id(1), id(2), [id(10)])).get(id(10))?.assignment_question.exam_use_snapshot).toEqual(exam);
  });
  it("준비 경합만 복구 대상으로 구분하고 깨진 참조는 그대로 실패한다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "preparation_unavailable" } })
      .mockResolvedValueOnce({ data: null, error: { code: "55000", message: "private binding changed" } });
    await expect(getPreparationQuestionContents(id(1), id(2), [id(10)])).rejects.toBeInstanceOf(QuestionContentPreparationChangedError);
    await expect(getPreparationQuestionContents(id(1), id(2), [id(10)])).rejects.toThrow("문항 내용을 불러오지 못했습니다.");
  });
  it("학습 요청도 학생과 배정 문맥을 전달한다", async () => {
    mocks.rpc.mockResolvedValue({ data: envelope("student_assignment", [{ id: id(10), vocab_entry_id: 10, prompt: "She _____ it." }]), error: null });
    expect((await getAssignmentStudyQuestionContents(id(1), id(2), [id(10)])).get(id(10))?.prompt).toBe("She _____ it.");
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_context: "student_assignment", p_actor_id: id(1), p_context_id: id(2) });
  });
});
