import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), registry: vi.fn(), active: vi.fn(), synthetic: vi.fn(), approved: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/services/quiz/pronunciation-registry", () => ({
  loadVocabPronunciationRegistry: mocks.registry,
  loadActiveVocabPronunciationReleaseRegistry: mocks.active,
  loadSyntheticPronunciationRegistry: mocks.synthetic,
  loadApprovedKoreanPronunciationRegistry: mocks.approved,
}));
import { getAssignmentStudy } from "./assignment-study-query";

const id = "00000000-0000-4000-8000-000000000001";
const student = { studentId: "00000000-0000-4000-8000-000000000002" };
const word = { entryId: 7, headword: "collect", meaning: "모으다", displayKo: "컬렉트", pronunciationSnapshot: null, dictionaryId: null, releaseId: null, definition: "to gather things", example: "She collected the letters." };
const raw = (mode = "book_meaning_choice") => ({ assignmentId: id, title: "배정 단어", mode, words: [word] });
beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [mocks.registry, mocks.active, mocks.synthetic, mocks.approved]) fn.mockResolvedValue(new Map());
  mocks.rpc.mockResolvedValue({ data: raw(), error: null });
});
describe("배정 단어장 서버 조회", () => {
  it("세션 학생만 전달하고 발음 대상은 선택지가 아닌 배정 단어 ID뿐이다", async () => {
    const result = await getAssignmentStudy(student, id);
    expect(mocks.rpc).toHaveBeenCalledWith("get_student_assignment_study_v1", { p_assignment_id: id, p_student_id: student.studentId });
    expect(mocks.registry).toHaveBeenCalledWith([7]);
    expect(result?.words[0]).toMatchObject({ headword: "collect", meaning: "모으다", definition: null, example: null });
    expect(Object.keys(result!.words[0]!)).toEqual(["key", "headword", "meaning", "definition", "example", "pronunciation"]);
  });
  it.each(["canonical_definition_to_headword", "canonical_example_to_headword"])("%s에 해당하는 학습 원문만 공개한다", async (mode) => {
    mocks.rpc.mockResolvedValue({ data: { ...raw(mode), choices: ["secret"], correct_choice_index: 2 }, error: null });
    const result = await getAssignmentStudy(student, id);
    expect(result?.words[0]?.definition).toBe(mode.includes("definition") ? word.definition : null);
    expect(result?.words[0]?.example).toBe(mode.includes("example") ? "She collected the letters." : null);
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
  it("접근할 수 없는 배정은 원문과 발음을 조회하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getAssignmentStudy(student, id)).toBeNull();
    expect(mocks.registry).not.toHaveBeenCalled();
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
});
