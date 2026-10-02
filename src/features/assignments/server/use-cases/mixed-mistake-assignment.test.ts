import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), prepare: vi.fn(), freeze: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../planning/mixed-mistake-assignment", () => ({ prepareMixedMistakeAssignment: mocks.prepare,
  mixedMistakeSelection: (input: { datasetId: string }) => ({ mode: "mixed", datasetId: input.datasetId }) }));
vi.mock("@/features/quiz-player/public-server", async original => ({ ...await original<typeof import("@/features/quiz-player/public-server")>(), freezeMistakePracticeQuestions: mocks.freeze }));
import { mixedMistakeSaveSchema } from "../../contracts/mixed-mistake-assignment";
import { saveMixedMistakeAssignment } from "./mixed-mistake-assignment";

const id = (n: number) => `a3040000-0000-4000-8000-${String(n).padStart(12, "0")}`, hash = "a".repeat(64);
const input = mixedMistakeSaveSchema.parse({ planVersion: "meaning-episode-v1", studentId: id(1), datasetId: id(2), primaryUnitIds: [id(3)],
  reviewLevels: [1, 2], totalQuestionCount: 4, englishToKoreanRatio: 50, timeLimitSeconds: 60, passingScore: 80,
  retryEnabled: false, retryPassingScore: null, availableUntil: null, idempotencyKey: id(4), selectionFingerprint: hash,
  excludeUnavailableConfirmed: false, banksConfirmed: false });
const saved = [{ studentId: id(1), assignmentId: id(50), questionCount: 4 }];
function fixture() {
  const review = [20, 21, 22].map(n => ({ kind: "review", word: { meaningKey: String(n) }, generated: null }));
  const prepared = { source: { sourceHash: "b".repeat(64), words: review.map((item, i) => ({ ...item.word, queueId: id(30 + i) })) },
    plan: {}, primaryRequests: [{ entryId: 1, direction: "english_to_korean" }], primarySourceHash: "c".repeat(64),
    preview: { error: null as string | null, selectionFingerprint: hash, unavailableCount: 0 },
    banks: [{ index: 0, questionCount: 4, primaryQuestionCount: 1, reviewMeaningCount: 3, quizContentMode: "book_meaning_choice", englishToKoreanRatio: 50,
      timeLimitSeconds: 60, items: [{ kind: "primary", proof: { meaningKey: "1", wordKey: "word:one", meaningProofHash: "d".repeat(64) },
        generated: { vocabEntryId: 1, direction: "english_to_korean", choiceVocabEntryIds: [1, 2, 3, 4] } }, ...review] }] };
  mocks.prepare.mockResolvedValue(prepared);
  mocks.freeze.mockResolvedValue(review.map(item => ({ meaningKey: item.word.meaningKey, sourceQuestionId: id(Number(item.word.meaningKey)), sourcePhase: "retry" })));
  const flags = { receipt: false };
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "get_notebook_assignment_result_v1" ? flags.receipt ? saved : null : saved, error: null }));
  return { prepared, flags };
}
beforeEach(() => vi.resetAllMocks());
describe("혼합 배정 저장과 재확인", () => {
  it("이전 요청과 다른 내용은 PT409로 한 번 종료하고 새 원천을 만들지 않는다", async () => {
    fixture();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409", message: "notebook_request_conflict" } });
    await expect(saveMixedMistakeAssignment(id(9), input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.freeze).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("서버가 정한 원큐·원단계와 선택한 일반 뜻 증명을 원자 저장에 전달한다", async () => {
    fixture(); expect(await saveMixedMistakeAssignment(id(9), input)).toEqual({ planVersion: "meaning-episode-v1", kind: "mistake_batch", assignments: saved });
    const batch = mocks.rpc.mock.calls.find(call => call[0] === "create_mixed_mistake_assignments_v1")![1].p_batches[0];
    expect(batch).toMatchObject({ studentId: id(1), audienceMode: "single", sourceHash: "b".repeat(64), primarySourceHash: "c".repeat(64),
      banks: [{ primaryQuestions: [{ vocab_entry_id: 1, base_order_index: 1, meaningKey: "1", meaningProofHash: "d".repeat(64) }],
        reviewQuestions: [{ meaningKey: "20", queueId: id(30), sourcePhase: "retry" }, { meaningKey: "21" }, { meaningKey: "22" }] }] });
    expect(mocks.freeze).toHaveBeenCalledWith(id(1), expect.anything(), { kind: "admin", adminId: id(9) });
  });
  it("기존 저장 결과는 바뀐 원천·지난 마감보다 먼저 반환한다", async () => {
    const f = fixture(); f.flags.receipt = true; mocks.prepare.mockRejectedValue(new Error("must not read source"));
    expect((await saveMixedMistakeAssignment(id(9), { ...input, availableUntil: "2000-01-01T00:00:00Z" })).assignments).toEqual(saved);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.freeze).not.toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["prepare", "write"])("%s 실패 도중 이미 저장한 요청은 같은 영수증으로 복구한다", async stage => {
    const f = fixture();
    if (stage === "prepare") mocks.prepare.mockImplementation(async () => { f.flags.receipt = true; throw new Error("network"); });
    else {
      const original = mocks.rpc.getMockImplementation()!;
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "create_mixed_mistake_assignments_v1") { f.flags.receipt = true; return { data: null, error: { code: "08006", message: "network" } }; }
        return original(name);
      });
    }
    expect((await saveMixedMistakeAssignment(id(9), input)).assignments).toEqual(saved);
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "get_notebook_assignment_result_v1")).toHaveLength(2);
  });
  it("다른 학생·부분 성공·같은 시험 중복은 성공으로 받지 않는다", async () => {
    fixture();
    for (const receipt of [[{ ...saved[0], studentId: id(99) }], [{ ...saved[0], questionCount: 3 }], [saved[0], saved[0]]]) {
      mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null });
      await expect(saveMixedMistakeAssignment(id(9), input)).rejects.toMatchObject({ status: 503 });
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("확인값과 제외·시험 분할 확인이 빠지면 원문 복원과 쓰기 전에 거절한다", async () => {
    const f = fixture();
    await expect(saveMixedMistakeAssignment(id(9), { ...input, selectionFingerprint: "f".repeat(64) })).rejects.toMatchObject({ status: 409, code: "source_changed" });
    f.prepared.preview.unavailableCount = 1;
    await expect(saveMixedMistakeAssignment(id(9), input)).rejects.toMatchObject({ status: 422 });
    f.prepared.banks.push({ ...f.prepared.banks[0], index: 1 });
    await expect(saveMixedMistakeAssignment(id(9), { ...input, excludeUnavailableConfirmed: true })).rejects.toMatchObject({ status: 422 });
    expect(mocks.freeze).not.toHaveBeenCalled(); expect(mocks.rpc.mock.calls.some(call => call[0] === "create_mixed_mistake_assignments_v1")).toBe(false);
  });
});
