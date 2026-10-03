import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), contents: vi.fn(), hydrate: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => mocks }));
vi.mock("./queries/transition-question-content-query", async original => ({ ...await original<typeof import("./queries/transition-question-content-query")>(), getTransitionPreparationContents: mocks.contents }));
vi.mock("@/lib/services/quiz/attempt-query", () => ({ getStudentAttempt: vi.fn(), hydrateQuizQuestions: mocks.hydrate }));
import { TransitionPreparationChangedError } from "./queries/transition-question-content-query";
import { getQuizPreparation, QuizPreparationChangedError } from "./attempt-preparation";
const id = (n: number) => `b3040000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot = { vocab_entry_id: 1, choice_vocab_entry_ids: [1, 2, 3, 4], headword_snapshot: "frozen", primary_meaning_snapshot: "당시 뜻",
  provenance_status: "legacy_backfill", composition_pronunciation_snapshot: null, notebook_pronunciation_snapshot: null, exam_use_snapshot: null };
const bank = { id: id(4), prompt: "frozen", ...snapshot };
const question = { id: id(3), assignment_question_id: id(4), vocab_entry_id: 1, order_index: 1, direction: "english_to_korean", prompt: "frozen",
  choices: ["당시 뜻", "둘", "셋", "넷"], correct_choice_index: 0 };
const prepared = { id: id(1), kind: "initial", begunId: null,
  assignment: { id: id(2), title: "가짜 전환 시험", quiz_content_mode: "book_meaning_choice", timing_mode: "none", question_time_limit_seconds: null }, plan: [question] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValueOnce({ data: prepared, error: null });
  for (const name of ["from", "select", "eq"] as const) mocks[name].mockReturnValue(mocks);
  mocks.in.mockResolvedValue({ data: [bank], error: null });
  const pronunciation = { displayKo: null, variantId: null, audioUrl: null, available: false };
  mocks.hydrate.mockImplementation(async rows => rows.map((q: typeof question) => ({ id: q.id, orderIndex: q.order_index, direction: q.direction,
    prompt: q.prompt, choices: q.choices, pronunciation, choicePronunciations: Array(4).fill(pronunciation), initialChoiceIndex: null, initialIsCorrect: null,
    retryChoiceIndex: null, retryIsCorrect: null, priorWrongLevel: 0, initialTimedOut: false, retryTimedOut: false, revealedCorrectChoiceIndex: null })));
  mocks.contents.mockResolvedValue(new Map([[id(4), { id: id(4), assignment_question: snapshot }]]));
});
it("기존 본문은 새 열이나 추가 RPC 없이 원 계획과 시각 없는 준비를 보존한다", async () => {
  const result = await getQuizPreparation(id(6), id(1));
  expect(result).toMatchObject({ id: id(1), assignmentTitle: prepared.assignment.title, currentQuestionId: id(3), questions: [{ id: id(3), prompt: "frozen", choices: question.choices }] });
  expect(result).not.toHaveProperty("startedAt");
  expect(mocks.contents).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.select.mock.calls[0][0]).not.toContain("content_version_id");
  expect(mocks.hydrate.mock.calls[0][0][0].assignment_question).toEqual({ id: id(4), ...snapshot });
});
it("명시 NULL만 준비 ID에 묶어 복원하며 같은 계획·뜻·발음을 사용한다", async () => {
  mocks.in.mockResolvedValue({ data: [{ ...bank, prompt: null, headword_snapshot: null, primary_meaning_snapshot: null }], error: null });
  const result = await getQuizPreparation(id(6), id(1));
  expect(mocks.contents).toHaveBeenCalledExactlyOnceWith(id(6), id(1), [id(4)]);
  expect(mocks.hydrate.mock.calls[0][0][0]).toMatchObject({ ...question, assignment_question: snapshot });
  expect(result).toMatchObject({ currentQuestionId: id(3), questions: [{ id: id(3), prompt: "frozen" }] });
});
it("혼합 배정의 NULL 문항만 요청하며 원래 순서를 지킨다", async () => {
  mocks.rpc.mockReset().mockResolvedValue({ data: { ...prepared, plan: [question, { ...question, id: id(7), assignment_question_id: id(8), order_index: 2 }] }, error: null });
  mocks.in.mockResolvedValue({ data: [bank, { ...bank, id: id(8), prompt: null }], error: null });
  mocks.contents.mockResolvedValue(new Map([[id(8), { id: id(8), assignment_question: snapshot }]]));
  await getQuizPreparation(id(6), id(1));
  expect(mocks.contents).toHaveBeenCalledExactlyOnceWith(id(6), id(1), [id(8)]);
  expect(mocks.hydrate.mock.calls[0][0].map((q: { id: string }) => q.id)).toEqual([id(3), id(7)]);
});
it.each([null, [], [bank, bank], [{ ...bank, id: id(99) }], [{ ...bank, prompt: undefined }], [{ ...bank, prompt: "" }]])("누락·오염·중복 행을 복원으로 숨기지 않는다", async data => {
  mocks.in.mockResolvedValue({ data, error: null });
  await expect(getQuizPreparation(id(6), id(1))).rejects.toThrow();
  expect(mocks.contents).not.toHaveBeenCalled();
  expect(mocks.hydrate).not.toHaveBeenCalled();
});
it("복원된 본문이 다른 단어면 실패한다", async () => {
  mocks.in.mockResolvedValue({ data: [{ ...bank, prompt: null }], error: null });
  mocks.contents.mockResolvedValue(new Map([[id(4), { id: id(4), assignment_question: { ...snapshot, vocab_entry_id: 99 } }]]));
  await expect(getQuizPreparation(id(6), id(1))).rejects.toThrow("preparation_changed");
});
it("다른 탭이 먼저 시작한 경합만 같은 응시로 복구한다", async () => {
  mocks.in.mockResolvedValue({ data: [{ ...bank, prompt: null }], error: null });
  mocks.contents.mockRejectedValue(new TransitionPreparationChangedError("preparation_changed"));
  mocks.rpc.mockResolvedValueOnce({ data: { id: id(1), kind: "initial", begunId: id(5) }, error: null });
  expect(await getQuizPreparation(id(6), id(1))).toEqual({ resumeId: id(5), kind: "initial" });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.hydrate).not.toHaveBeenCalled();
});
it.each([null, { kind: "initial", begunId: null }])("준비 만료 경합은 확정된 재준비 안내로 변환한다", async refreshed => {
  mocks.in.mockResolvedValue({ data: [{ ...bank, prompt: null }], error: null });
  mocks.contents.mockRejectedValue(new TransitionPreparationChangedError("preparation_unavailable"));
  mocks.rpc.mockResolvedValueOnce({ data: refreshed, error: null });
  await expect(getQuizPreparation(id(6), id(1))).rejects.toBeInstanceOf(QuizPreparationChangedError);
});
it("깨진 본문 참조를 준비 재조회로 숨기지 않는다", async () => {
  mocks.in.mockResolvedValue({ data: [{ ...bank, prompt: null }], error: null });
  mocks.contents.mockRejectedValue(new Error("question_content_binding_mismatch"));
  await expect(getQuizPreparation(id(6), id(1))).rejects.toThrow("question_content_binding_mismatch");
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
