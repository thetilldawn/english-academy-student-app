import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), hydrate: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/features/students/public-server", () => ({ hydratePronunciationRows: mocks.hydrate }));
import { getPracticeHistory, previewPractice, startPractice } from "./practice-service";
import { practicePreviewInputSchema, type PracticeInput } from "../contracts/practice";

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
    ["practice_source_changed", "PT409", 409, "source_changed"],
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

function studentMistakeSource(mode: "mistakes" | "mistake_filters") {
  const voice = { displayKo: "저장 발음", variantId: "mw:" + "1".repeat(20),
    audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3", available: true };
  const word = { key: "b".repeat(64), meaningKey: "b".repeat(64), wordKey: "word:collect", episodeId: id(32),
    headword: "collect", primaryMeaning: "과거 뜻", selectedText: "The original English text ____.", testedField: "example",
    latestVocabEntryId: 7, choiceSafety: null, frozenOnly: true, sourceQuestionId: id(30), sourceAttemptId: id(31),
    sourcePhase: "retry", sourceContentHash: "c".repeat(64),
    frozenQuestion: { quizContentMode: "canonical_example_to_headword", direction: "korean_to_english",
      prompt: "The original English text ____.", choices: ["travel", "collect", "patient", "enormous"], correctChoiceIndex: 1 } };
  const source = { sourceHash: "a".repeat(64), candidates: [], words: [word] };
  const flags = { changedBody: false };
  const value = practicePreviewInputSchema.parse({ ...input, settings: { ...input.settings, englishToKoreanRatio: 0 },
    selection: mode === "mistakes" ? { mode, view: "current", stateVersion: "1",
      meanings: [{ wordKey: word.wordKey, meaningKey: word.meaningKey, episodeId: word.episodeId }] }
      : { mode, stateVersion: "1", filters: {} } });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "get_student_word_practice_v1" || name === "find_word_practice_preparation_v1") return { data: null, error: null };
    if (name === "prepare_student_word_practice_v1") return { data: source, error: null };
    if (name === "list_pronunciation_audio_corrections_v1") return { data: [], error: null };
    if (name === "read_question_contents_v1") return { data: { schemaVersion: "question-content-read-v1", context: args.p_context,
      items: [{ id: word.sourceQuestionId, prompt: flags.changedBody ? "Changed text" : word.frozenQuestion.prompt,
        choices: word.frozenQuestion.choices, assignment_question: { vocab_entry_id: 7, choice_vocab_entry_ids: [8, 7, 9, 10],
          headword_snapshot: "collect", primary_meaning_snapshot: "과거 뜻", provenance_status: "notebook_snapshot_v1",
          composition_pronunciation_snapshot: null, notebook_pronunciation_snapshot: { target: voice, choices: [voice, voice, voice, voice] },
          exam_use_snapshot: null } }] }, error: null };
    if (name === "prepare_word_practice_start_v1") return { data: id(40), error: null };
    throw new Error("Unexpected student practice RPC: " + name);
  });
  return { value, source, word, voice, flags };
}

describe("학생 현재 오답의 실제 준비 연결", () => {
  it.each(["mistakes", "mistake_filters"] as const)("%s는 학생 권한으로 원문·뜻·구간을 준비 저장까지 유지한다", async mode => {
    const f = studentMistakeSource(mode), preview = await previewPractice(id(3), f.value);
    expect(preview).toMatchObject({ availableCount: 1, totalCount: 1, error: null,
      words: [{ key: f.word.key, headword: "collect", primaryMeaning: f.word.selectedText }] });
    expect(JSON.stringify(preview)).not.toContain("correctChoiceIndex");
    expect(await startPractice(id(3), { ...f.value, confirmation: preview.confirmation! }, true)).toEqual({ preparationId: id(40) });
    expect(mocks.rpc).toHaveBeenCalledWith("read_question_contents_v1", { p_context: "student_attempt", p_actor_id: id(3),
      p_context_id: id(31), p_question_ids: [id(30)] });
    const calls = mocks.rpc.mock.calls.filter(call => call[0] === "prepare_word_practice_start_v1");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ p_student_id: id(3), p_selection: f.value.selection, p_source_hash: f.source.sourceHash,
      p_questions: [{ wordKey: f.word.wordKey, meaningKey: f.word.meaningKey, episodeId: f.word.episodeId,
        sourceQuestionId: id(30), sourcePhase: "retry", sourceContentHash: f.word.sourceContentHash,
        quizContentMode: f.word.frozenQuestion.quizContentMode, prompt: f.word.frozenQuestion.prompt,
        choices: f.word.frozenQuestion.choices, correctChoiceIndex: 1, choicePronunciations: [f.voice, f.voice, f.voice, f.voice] }] });
    expect(calls[0][1].p_questions[0].pronunciation.available).toBe(false);
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it.each(["mistakes", "mistake_filters"] as const)("%s의 확인한 원천이 바뀌면 문항 조회와 저장을 시작하지 않는다", async mode => {
    const f = studentMistakeSource(mode), preview = await previewPractice(id(3), f.value);
    f.source.sourceHash = "d".repeat(64);
    await expect(startPractice(id(3), { ...f.value, confirmation: preview.confirmation! }, true))
      .rejects.toMatchObject({ status: 409, code: "source_changed" });
    expect(mocks.rpc.mock.calls.some(call => ["read_question_contents_v1", "prepare_word_practice_start_v1"].includes(call[0]))).toBe(false);
  });
  it("학생의 고정 원문 조회가 원래 문항과 다르면 준비를 저장하지 않는다", async () => {
    const f = studentMistakeSource("mistakes"), preview = await previewPractice(id(3), f.value);
    f.flags.changedBody = true;
    await expect(startPractice(id(3), { ...f.value, confirmation: preview.confirmation! }, true))
      .rejects.toMatchObject({ status: 409, code: "source_changed" });
    expect(mocks.rpc.mock.calls.some(call => call[0] === "prepare_word_practice_start_v1")).toBe(false);
  });
});
