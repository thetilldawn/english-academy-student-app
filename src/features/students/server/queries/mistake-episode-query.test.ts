import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), rpc: vi.fn(), registry: vi.fn(), corrections: vi.fn() }));
vi.mock("@/lib/auth/student-session", () => ({ getStudentSession: mocks.session }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/services/quiz/pronunciation-registry", () => ({ loadVocabPronunciationRegistry: mocks.registry, loadActiveVocabPronunciationReleaseRegistry: mocks.registry,
  loadSyntheticPronunciationRegistry: mocks.registry, loadApprovedKoreanPronunciationRegistry: mocks.registry, loadEntryApprovedKoreanPronunciationRegistry: mocks.registry,
  loadEntrySourcePronunciationRegistry: mocks.registry, loadPronunciationAudioCorrections: mocks.corrections }));
import { decodeMistakeCursor, getOwnMistakePage, getAdminMistakePage, getMistakeStudyPage } from "./mistake-episode-query";
import { mistakeFiltersSchema, mistakeTarget } from "../../contracts/mistake-episode";
import { hydratePronunciationRows } from "./notebook-study-query";
import { mistakeEpisodeCursorSchema, mistakeEpisodeIdSchema } from "../../contracts/mistake-episode-history";

const id = (n: number) => `a3030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const filters = mistakeFiltersSchema.parse({});
const date = "2026-10-02T00:00:00.123456Z";
const counts = { currentWrongCount: 1, lifetimeWrongCount: 4, currentMissedCount: 0, lifetimeMissedCount: 0 };
const source = { datasetId: id(2), entryId: 1, label: "가짜 출처", ...counts, lastWrongAt: date, sourceQuestionId: id(5), sourcePhase: "initial", episodeId: id(3) };
const meaning = { ...counts, meaningKey: "b".repeat(64), episodeId: id(3), stateVersion: "12", legacyWrongCount: 0, countQuality: "exact" as const,
  scheduling:'available',queueId:null,reviewDraftId:null,activeAssignment:null,isCurrentEpisode:true,
  episodeCount: 1, episodes: [], episodeNextCursor: null,
  unresolved: true, resolvedAt: null, lastWrongAt: date, testedField: "primary_meaning" as const, identityKind: "reviewed-meaning-v1", selectedText: "가짜 뜻", primaryMeaning: "가짜 뜻",
  sourceEntryId: 1, sourceDatasetId: id(2), sourceLabel: "가짜 출처", sources: [source], sourceQuestionId: id(5), sourceAttemptId: id(6), sourcePhase: "initial" as const };
const pronunciation = { displayKo: "페이크", variantId: null, audioUrl: null, available: false };
const studySource = { entryId: 1, currentHeadword: "fake", snapshotDisplayKo: null, dictionaryId: "word:fake", releaseId: null, displayKo: null,
  pronunciationSnapshot: null, compositionPronunciation: pronunciation, definition: null, example: null, exampleKo: null };
const cursor = { studentId: id(1), filtersHash: "a".repeat(64), stateVersion: "12", sourceVersion: "c".repeat(64), key: "dictionary:fake", count: 1, lastWrongAt: date };
const word = { key: cursor.key, sourceVersion: cursor.sourceVersion, headword: "fake", primaryMeaning: "가짜 뜻", ...counts, legacyWrongCount: 0, lastWrongAt: date, meanings: [meaning], cursor, studySource, choices: ["secret"] };
const raw = { view: "current", sourceVersion: cursor.sourceVersion, stateVersion: "12", totalCount: 1, summary: { wordCount: 1, currentWrongCount: 1, lifetimeWrongCount: 4, currentMissedCount: 0, legacyWrongCount: 0 },
  schedulingBasis:'current',schedulingAsOf:date,reviewDrafts:[],
  datasetOptions: [{ id: id(2), label: "가짜 출처" }], items: [word] };
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ studentId: id(1) }); mocks.admin.mockResolvedValue({});
  mocks.rpc.mockResolvedValue({ data: raw, error: null }); mocks.registry.mockResolvedValue(new Map()); mocks.corrections.mockResolvedValue([]); });

describe("뜻별 오답 조회의 서버 경계", () => {
  it("기존 해시 구간키를 목록·상세·이력 커서·배정 대상까지 변경 없이 읽는다", async () => {
    const episodeId = "abcdef01-2345-f678-0123-456789abcdef";
    const oldMeaning = { ...meaning, episodeId, countQuality: "legacy-continuation", legacyWrongCount: 4,
      sources: [{ ...source, episodeId }],
      episodes: [{ episodeId, openedAt: date, resolvedAt: null, wrongCount: 4, missedCount: 0, includesLegacy: true }] };
    mocks.rpc.mockResolvedValue({ data: { ...raw, items: [{ ...word, meanings: [oldMeaning] }] }, error: null });
    const student = await getMistakeStudyPage({ filters });
    expect(student!.items[0].meanings[0].episodeId).toBe(episodeId);
    expect(student!.items[0].meanings[0].episodes[0].episodeId).toBe(episodeId);
    const admin = await getAdminMistakePage(id(1), { filters });
    expect(mistakeTarget(admin!.items[0].meanings[0])?.episodeId).toBe(episodeId);
    const historyCursor = { schemaVersion: "vocabulary-mistake-episode-cursor-v1", studentId: id(1),
      meaningKey: meaning.meaningKey, stateVersion: "12", lastSequence: "0", openedAt: date, episodeId };
    expect(mistakeEpisodeCursorSchema.parse(historyCursor).episodeId).toBe(episodeId);
    expect(mistakeEpisodeCursorSchema.safeParse({ ...historyCursor, studentId: episodeId }).success).toBe(false);
    for (const value of ["", "invalid", "abcdef01-2345-f678-0123-456789abcdeg", episodeId + "x"]) {
      expect(mistakeEpisodeIdSchema.safeParse(value).success).toBe(false);
    }
  });
  it("자료판을 상세에도 보존하며 서로 다른 자료판·상태판의 응답은 섞지 않는다", async () => {
    const page = await getMistakeStudyPage({ filters });
    expect(page?.sourceVersion).toBe(cursor.sourceVersion);
    expect(page?.items[0].sourceVersion).toBe(cursor.sourceVersion);
    for (const item of [{ ...word, sourceVersion: 'd'.repeat(64) }, { ...word, cursor: { ...cursor, sourceVersion: 'd'.repeat(64) } },
      { ...word, cursor: { ...cursor, stateVersion: '13' } }, { ...word, meanings: [{ ...meaning, stateVersion: '13' }] }, { ...word, sourceVersion: null }]) {
      mocks.rpc.mockResolvedValueOnce({ data: { ...raw, items: [item] }, error: null });
      await expect(getMistakeStudyPage({ filters })).rejects.toMatchObject({ reason: 'unavailable' });
    }
  });
  it("본인 세션으로만 조회하고 관리자 출처·정답·원본문을 제거한다", async () => {
    const result = await getOwnMistakePage({ filters });
    expect(result?.items[0]).toMatchObject({ currentWrongCount: 1, lifetimeWrongCount: 4 });
    expect(JSON.stringify(result)).not.toMatch(/sourceQuestionId|sourceAttemptId|sourcePhase|choices|studySource|filtersHash|wrongCount|reviewDraft|scheduling|activeAssignment|queueId/);
    expect(mocks.rpc).toHaveBeenCalledWith("get_student_vocabulary_mistake_page_v1", expect.objectContaining({ p_student_id: id(1), p_filters: expect.objectContaining({ view: "current" }) }));
  });
  it("관리자 뜻 선택에는 한 사건의 문항·단계·구간·상태판만 전달한다", async () => {
    const result = await getAdminMistakePage(id(1), { filters });
    expect(mocks.admin).toHaveBeenCalledOnce();
    expect(mistakeTarget(result!.items[0].meanings[0])).toEqual({ sourceQuestionId: id(5), sourcePhase: "initial", meaningKey: "b".repeat(64), episodeId: id(3), stateVersion: "12" });
    expect(mistakeTarget({ ...result!.items[0].meanings[0], unresolved: false })).toBeNull();
  });
  it("11개에서 10개만 반환하고 DB 커서를 변경 없이 되돌려 보낸다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...raw, totalCount: 11, items: Array.from({ length: 11 }, (_, n) => ({ ...word, key: `word:${n}`, cursor: { ...cursor, key: `word:${n}` } })) }, error: null });
    const first = await getOwnMistakePage({ filters });
    expect(first!.items).toHaveLength(10);
    expect(decodeMistakeCursor(first!.nextCursor!, id(1))).toEqual({ ...cursor, key: "word:9" });
    await getOwnMistakePage({ filters, cursor: first!.nextCursor });
    expect(mocks.rpc).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ p_cursor: { ...cursor, key: "word:9" } }));
  });
  it("null 상태판과 다른 학생 커서를 DB 호출 전 거절한다", async () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const invalid of [{ ...cursor, stateVersion: null }, { ...cursor, count: null }, { ...cursor, stateVersion: "9223372036854775808" }]) {
      await expect(getOwnMistakePage({ filters, cursor: encode(invalid) })).rejects.toMatchObject({ reason: "invalid" });
    }
    await expect(getOwnMistakePage({ filters, cursor: encode({ ...cursor, studentId: id(9) }) })).rejects.toMatchObject({ reason: "changed" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["40001", "wrong_history_changed", "changed"], ["PT409", "wrong_history_changed", "changed"], ["42501", "forbidden", "forbidden"], ["22023", "invalid_wrong_history_cursor", "invalid"], ["57014", "timeout", "unavailable"]])(
    "DB %s는 정상 빈 목록으로 바뀌지 않는다", async (code, message, reason) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
      await expect(getOwnMistakePage({ filters })).rejects.toMatchObject({ reason });
    });
  it("권한 없음·없는 학생·잘못된 첫 요약을 구별한다", async () => {
    mocks.session.mockResolvedValueOnce(null); await expect(getOwnMistakePage({ filters })).rejects.toMatchObject({ reason: "unauthenticated" });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect(await getOwnMistakePage({ filters })).toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: { ...raw, summary: null }, error: null }); await expect(getOwnMistakePage({ filters })).rejects.toMatchObject({ reason: "unavailable" });
  });
  it("발음 입력은 오답 횟수·구간 없이 사용할 수 있고 고정 발음은 보존한다", async () => {
    expect((await hydratePronunciationRows([{ headword: "fake", studySource }]))[0]).toMatchObject({ pronunciation });
    expect((await getMistakeStudyPage({ filters }))!.items[0]).toMatchObject({ pronunciation, currentWrongCount: 1, lifetimeWrongCount: 4 });
  });
});
