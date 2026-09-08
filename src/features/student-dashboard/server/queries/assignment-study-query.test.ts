import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), registry: vi.fn(), active: vi.fn(), synthetic: vi.fn(), approved: vi.fn(), entryApproved: vi.fn(), source: vi.fn(), prompts: vi.fn() }));
vi.mock("./assignment-study-example-query", () => ({ getStudyExamplePrompts: mocks.prompts }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/services/quiz/pronunciation-registry", () => ({
  loadVocabPronunciationRegistry: mocks.registry,
  loadActiveVocabPronunciationReleaseRegistry: mocks.active,
  loadSyntheticPronunciationRegistry: mocks.synthetic,
  loadApprovedKoreanPronunciationRegistry: mocks.approved,
  loadEntryApprovedKoreanPronunciationRegistry: mocks.entryApproved,
  loadEntrySourcePronunciationRegistry: mocks.source,
}));
import { getAssignmentStudy } from "./assignment-study-query";

const id = "00000000-0000-4000-8000-000000000001";
const student = { studentId: "00000000-0000-4000-8000-000000000002" };
const word = { entryId: 7, headword: "collect", meaning: "모으다", displayKo: "컬렉트", pronunciationSnapshot: null, dictionaryId: null, releaseId: null, definition: "to gather things", example: "She collected the letters." };
const raw = (mode = "book_meaning_choice") => ({ assignmentId: id, title: "배정 단어", mode, words: [word] });
beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [mocks.registry, mocks.active, mocks.synthetic, mocks.approved, mocks.entryApproved, mocks.source]) fn.mockResolvedValue(new Map());
  mocks.rpc.mockResolvedValue({ data: raw(), error: null });
  mocks.prompts.mockResolvedValue(new Map([[7, ["She _____ the letters."]]]));
});
describe("배정 단어장 서버 조회", () => {
  it("uses source proof for old completed study words, but not a different historical headword", async () => {
    const audio={displayKo:"자동",variantId:"mw:fake",audioUrl:"https://media.merriam-webster.com/audio/prons/en/us/mp3/c/collec01.mp3",available:true};
    mocks.active.mockResolvedValue(new Map([[7,audio]]));
    mocks.source.mockResolvedValue(new Map([[7,[{entryId:7,headword:"collect",pronunciation:{...audio,displayKo:"컬렉트",segments:[{text:"컬",stress:"none"},{text:"렉",stress:"primary"},{text:"트",stress:"none"}]}}]]]));
    expect((await getAssignmentStudy(student,id))?.words?.[0].pronunciation.displayKo).toBe("컬렉트");
    mocks.rpc.mockResolvedValue({data:{...raw(),words:[{...word,headword:"different"}]},error:null});
    expect((await getAssignmentStudy(student,id))?.words?.[0].pronunciation.displayKo).toBe("자동");
    expect(mocks.source).toHaveBeenCalledWith([7]);
  });
  it.each(["waiting_initial", "waiting_time", "held", "schedule_conflict", "cancelled"])(
    "%s는 원문·영영풀이·예문·발음을 읽지 않고 상태만 돌려준다", async (state) => {
      const locked = { assignmentId: id, title: "2회차", mode: "canonical_example_to_headword",
        release: { state, opensAt: state === "waiting_time" ? "2030-01-01T00:00:00Z" : null, hasDeadline: true } };
      mocks.rpc.mockResolvedValue({ data: locked, error: null });
      expect(await getAssignmentStudy(student, id)).toEqual(locked);
      for (const fn of [mocks.registry, mocks.active, mocks.synthetic, mocks.approved, mocks.entryApproved, mocks.source, mocks.prompts]) {
        expect(fn).not.toHaveBeenCalled();
      }
      mocks.rpc.mockResolvedValue({ data: { ...locked, words: [word] }, error: null });
      await expect(getAssignmentStudy(student, id)).rejects.toThrow("assignment_study_data_invalid");
    },
  );
  it("세션 학생만 전달하고 발음 대상은 선택지가 아닌 배정 단어 ID뿐이다", async () => {
    const result = await getAssignmentStudy(student, id);
    expect(mocks.rpc).toHaveBeenCalledWith("get_student_assignment_study_v1", { p_assignment_id: id, p_student_id: student.studentId });
    expect(mocks.registry).toHaveBeenCalledWith([7]);
    expect(mocks.entryApproved).toHaveBeenCalledWith([7]);
    expect(result?.words?.[0]).toMatchObject({ headword: "collect", meaning: "모으다", definition: null, example: null });
    expect(Object.keys(result!.words![0]!)).toEqual(["key", "headword", "meaning", "definition", "example", "exampleRanges", "pronunciation"]);
    expect(mocks.prompts).not.toHaveBeenCalled();
  });
  it.each(["canonical_definition_to_headword", "canonical_example_to_headword"])("%s에 해당하는 학습 원문만 공개한다", async (mode) => {
    mocks.rpc.mockResolvedValue({ data: { ...raw(mode), choices: ["secret"], correct_choice_index: 2 }, error: null });
    const result = await getAssignmentStudy(student, id);
    expect(result?.words?.[0]?.definition).toBe(mode.includes("definition") ? word.definition : null);
    expect(result?.words?.[0]?.example).toBe(mode.includes("example") ? "She collected the letters." : null);
    if (mode.includes("example")) {
      expect(mocks.prompts).toHaveBeenCalledExactlyOnceWith(id, [7]);
      expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.prompts.mock.invocationCallOrder[0]!);
      expect(result?.words?.[0]?.exampleRanges).toEqual([{ start: 4, end: 13 }]);
    } else expect(mocks.prompts).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/secret|choice|entryId|Snapshot|releaseId|orderIndex/u);
  });
  it("완전 중복만 제거하고 같은 철자의 다른 뜻을 보존한다", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...raw(), words: [word, word, { ...word, meaning: "수금하다" }] }, error: null });
    expect((await getAssignmentStudy(student, id))?.words).toHaveLength(2);
  });
  it("legacy 일반형을 그대로 지원한다", async () => {
    mocks.rpc.mockResolvedValue({ data: raw("legacy_book_meaning_choice"), error: null });
    expect((await getAssignmentStudy(student, id))?.mode).toBe("book_meaning_choice");
  });
  it.each(["book_meaning_choice", "canonical_definition_to_headword", "canonical_example_to_headword"])("%s 공부 화면도 원음과 문맥을 보존하며 승인 표기를 사용한다", async (mode) => {
    const pronunciation = { displayKo: "자동", variantId: "mw:sample", audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3", available: true };
    const corrected = { ...pronunciation, displayKo: "승인", segments: [{ text: "승인", stress: "primary" }] };
    mocks.active.mockResolvedValue(new Map([[7, pronunciation]]));
    mocks.entryApproved.mockResolvedValue(new Map([[7, { dictionaryId: "word:sample", pronunciation: corrected }]]));
    mocks.rpc.mockResolvedValue({ data: raw(mode), error: null });
    const result = await getAssignmentStudy(student, id);
    expect(result?.words?.[0]?.pronunciation).toEqual(corrected);
    expect(JSON.stringify(result)).not.toMatch(/dictionaryId|entryId|source_content|identity_content|correct_choice/);
  });
  it("접근할 수 없는 배정은 원문과 발음을 조회하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getAssignmentStudy(student, id)).toBeNull();
    expect(mocks.registry).not.toHaveBeenCalled();
    expect(mocks.prompts).not.toHaveBeenCalled();
    expect(await getAssignmentStudy(student, "bad-id")).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("잘못 연결된 배정·빈 목록·빈칸 예문을 조용히 표시하지 않는다", async () => {
    for (const data of [{ ...raw(), assignmentId: student.studentId }, { ...raw(), words: [] }, { ...raw(), words: [{ ...word, example: "She _____ them." }] }]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      await expect(getAssignmentStudy(student, id)).rejects.toThrow(/assignment_study_/u);
    }
  });
  it("조회 장애를 빈 단어장으로 위장하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "timeout" } });
    await expect(getAssignmentStudy(student, id)).rejects.toThrow("assignment_study_read_failed");
  });
  it("예문 위치 자료의 조회 실패와 일치 자료 없음을 구분한다", async () => {
    mocks.rpc.mockResolvedValue({ data: raw("canonical_example_to_headword"), error: null });
    mocks.prompts.mockRejectedValueOnce(new Error("assignment_study_example_read_failed"));
    await expect(getAssignmentStudy(student, id)).rejects.toThrow("assignment_study_example_read_failed");
    mocks.prompts.mockResolvedValueOnce(new Map());
    const result = await getAssignmentStudy(student, id);
    expect(result?.words?.[0]).toMatchObject({ example: word.example, exampleRanges: null });
  });
});
