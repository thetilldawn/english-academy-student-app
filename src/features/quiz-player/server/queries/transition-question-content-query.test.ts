import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => mocks }));
import { getTransitionPreparationContents, getTransitionStudyContents, TransitionPreparationChangedError } from "./transition-question-content-query";
const id = (n: number) => `b2040000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const body = (key: string) => ({ id: key, vocab_entry_id: 10, prompt: "She _____ it." });
const envelope = (context: string, items: unknown[]) => ({ schemaVersion: "question-content-read-v1", context, items });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: envelope(args.p_context, args.p_question_ids.map(body)), error: null }));
});
describe("전환용 최소 본문 계약", () => {
  it("201개를 200개씩 묶고 중복과 빈 요청을 보내지 않는다", async () => {
    const ids = Array.from({ length: 201 }, (_, n) => id(n + 10));
    expect((await getTransitionStudyContents(id(1), id(2), [...ids, ids[0]])).size).toBe(201);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_question_ids.length)).toEqual([200, 1]);
    expect(mocks.rpc.mock.calls[0]).toEqual(["read_m10_transition_question_contents_v1", {
      p_context: "student_assignment", p_actor_id: id(1), p_context_id: id(2), p_question_ids: ids.slice(0, 200),
    }]);
    expect(await getTransitionPreparationContents(id(1), id(2), [])).toEqual(new Map());
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([
    envelope("admin_attempt", [body(id(10))]), envelope("student_assignment", []),
    envelope("student_assignment", [body(id(11))]), envelope("student_assignment", [body(id(10)), body(id(10))]),
    envelope("student_assignment", [{ ...body(id(10)), prompt: null }]),
    envelope("student_assignment", [{ ...body(id(10)), correct_choice_index: 0 }]),
    { ...envelope("student_assignment", [body(id(10))]), schemaVersion: "unknown" },
  ])("누락·문맥·키·본문·정답 누출·버전 오류는 거절한다", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getTransitionStudyContents(id(1), id(2), [id(10)])).rejects.toThrow("transition_content_response_invalid");
  });
  it("같은 크기라도 순서가 바뀌거나 키가 중복되면 거절한다", async () => {
    for (const items of [[body(id(11)), body(id(10))], [body(id(10)), body(id(10))]]) {
      mocks.rpc.mockResolvedValue({ data: envelope("student_assignment", items), error: null });
      await expect(getTransitionStudyContents(id(1), id(2), [id(10), id(11)])).rejects.toThrow("transition_content_response_invalid");
    }
  });
  it("사전·출현의 문자 키와 동결된 뜻·발음을 보존한다", async () => {
    const exam = { release_id: id(4), occurrence_id: "occ:fake:1", dictionary_id: "word:fake", pronunciation_variant_id: "mw:fake",
      headword_snapshot: "past", primary_meaning_snapshot: "당시 뜻", display_pronunciation_ko_snapshot: "패스트", pronunciation_snapshot: {},
      choice_dictionary_snapshots: [], provenance_status: "reviewed_for_preview_v1" };
    const snapshot = { vocab_entry_id: 10, choice_vocab_entry_ids: [10, 11, 12, 13], headword_snapshot: "past", primary_meaning_snapshot: "당시 뜻",
      provenance_status: "legacy_backfill", composition_pronunciation_snapshot: null, notebook_pronunciation_snapshot: null, exam_use_snapshot: exam };
    mocks.rpc.mockResolvedValue({ data: envelope("student_preparation", [{ id: id(10), assignment_question: snapshot }]), error: null });
    expect((await getTransitionPreparationContents(id(1), id(2), [id(10)])).get(id(10))?.assignment_question).toEqual(snapshot);
  });
  it.each(["40001", "PT409"])("준비 경합 %s만 재조회 대상으로 구분한다", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "preparation_unavailable" } });
    await expect(getTransitionPreparationContents(id(1), id(2), [id(10)])).rejects.toBeInstanceOf(TransitionPreparationChangedError);
    await expect(getTransitionStudyContents(id(1), id(2), [id(10)])).rejects.not.toBeInstanceOf(TransitionPreparationChangedError);
  });
  it.each(["42501", "42883", "55000"])("거절·미설치·깨진 참조 %s는 대체 조회하지 않는다", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private detail" } });
    await expect(getTransitionPreparationContents(id(1), id(2), [id(10)])).rejects.toThrow("문항 내용을 불러오지 못했습니다.");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
