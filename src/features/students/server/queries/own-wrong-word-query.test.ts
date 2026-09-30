import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth/student-session", () => ({ getStudentSession: mocks.session }));
vi.mock("@/lib/supabase/service", () => ({ getServiceSupabaseClient: () => ({ rpc: mocks.rpc }) }));
import { getOwnWrongWordPage } from "./own-wrong-word-query";
import { encodeWrongWordCursor } from "../wrong-word-cursor";
const student = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const filters = { datasetId: "", level: "all" as const, query: "" };
const raw = { items: [], eventUpperId: "0", totalCount: 0, summary: { wordCount: 0, wrongEventCount: 0, repeatedWordCount: 0 }, datasetOptions: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ studentId: student }); mocks.rpc.mockResolvedValue({ data: raw, error: null }); });
describe("학생 본인 오답 조회", () => {
  it("HTTP에서확인한서버세션은재조회하지않아한요청의인증읽기가중복되지않는다", async () => {
    await getOwnWrongWordPage({ filters }, { studentId: student, sessionId: other, displayName: "가짜", schoolName: null, gradeLabel: null, expiresAt: "2026-11-29T00:00:00Z", lastSeenAt: "2026-09-29T00:00:00Z" });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("현재 세션 학생만 한 RPC로 조회하며 정상0건을 유지한다", async () => {
    expect(await getOwnWrongWordPage({ filters: { ...filters, minWrongCount: 3 } })).toEqual({ ...raw, eventUpperId: undefined, nextCursor: null });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("get_student_wrong_word_notebook_page_v1", expect.objectContaining({ p_student_id: student, p_min_wrong_count: 3, p_max_wrong_count: null }));
  });
  it("미인증과 다른 학생의 커서는 DB 전에 거절한다", async () => {
    mocks.session.mockResolvedValueOnce(null);
    await expect(getOwnWrongWordPage({ filters })).rejects.toMatchObject({ reason: "unauthenticated" });
    const cursor = encodeWrongWordCursor({ studentId: other, filters, eventUpperId: "1", lastWrongAt: "2026-09-29T00:00:00.123456Z", key: "word" });
    await expect(getOwnWrongWordPage({ filters, cursor })).rejects.toMatchObject({ reason: "identity" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("없음·DB실패·잘못된응답·요약누락을 구별한다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "secret" } })
      .mockResolvedValueOnce({ data: { ...raw, summary: null }, error: null }).mockResolvedValueOnce({ data: {}, error: null });
    expect(await getOwnWrongWordPage({ filters })).toBeNull();
    for (let n = 0; n < 3; n++) await expect(getOwnWrongWordPage({ filters })).rejects.toThrow("오답 단어를 불러오지 못했습니다");
  });
  it("11개를10개와커서로 나누고 DB의 관리필드도최소DTO에서 제거한다", async () => {
    const item = { key: "word", headword: "word", primaryMeaning: "뜻", wrongCount: 3, lastWrongAt: "2026-09-29T00:00:00.123456Z",
      occurrences: [{ datasetId: other, vocabEntryId: 1, datasetLabel: "가짜 책", headword: "word", primaryMeaning: "뜻", provenanceStatus: "verified_v2", latestQuestionId: other }],
      latestQuestionId: other, activeAssignment: { assignmentId: other }, correctOption: 2 };
    mocks.rpc.mockResolvedValue({ data: { ...raw, eventUpperId: "11", totalCount: 11, items: Array.from({ length: 11 }, (_, n) => ({ ...item, key: "word" + n })), reviewDrafts: ["private"] }, error: null });
    const result = await getOwnWrongWordPage({ filters });
    expect(result?.items).toHaveLength(10); expect(result?.nextCursor).toBeTruthy();
    const serialized = JSON.stringify(result);
    for (const name of ["latestQuestionId", "activeAssignment", "correctOption", "reviewDrafts"]) expect(serialized).not.toContain(name);
  });
});

