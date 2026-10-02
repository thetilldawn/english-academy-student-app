import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), page: vi.fn(), mistakes: vi.fn() }));
vi.mock("@/lib/auth/student-session", () => ({ getStudentSession: mocks.session }));
vi.mock("@/features/students/public-server", async () => ({
  getNotebookPage: mocks.page,
  getMistakeStudyPage: mocks.mistakes,
  MistakeReadError: (await import("@/features/students/server/queries/mistake-episode-query")).MistakeReadError,
  ...(await import("@/features/students/server/wrong-word-cursor")),
  OwnWrongWordReadError: (await import("@/features/students/server/queries/own-wrong-word-query")).OwnWrongWordReadError,
}));
import { GET } from "./route";
import { WrongWordCursorError } from "@/features/students/server/wrong-word-cursor";
import { AuthenticationUnavailableError } from "@/lib/auth/authentication-error";
import { MistakeReadError } from "@/features/students/server/queries/mistake-episode-query";
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
const student={studentId:"self",sessionId:"fake-session"};
const identity=studentNotebookCacheIdentity(student);
const request = (query = "") => new Request("https://example.test/api/student/notebook?" + query,{headers:{"x-student-notebook-identity":identity}});
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(student); mocks.page.mockResolvedValue({ items: [], totalCount: 0, nextCursor: null }); });
describe("본인 오답 HTTP", () => {
  it("다른 세션의 목록 요청은 본문 조회 전에 거절한다",async()=>{
    mocks.session.mockResolvedValueOnce({...student,sessionId:"different-session"});
    const response=await GET(request("view=current"));expect(response.status).toBe(401);
    expect(mocks.mistakes).not.toHaveBeenCalled();expect(mocks.page).not.toHaveBeenCalled();
    expect((await GET(new Request("https://example.test/api/student/notebook?view=current"))).status).toBe(401);
  });
  it("조건만서버로넘기고모든응답은개인no-store다", async () => {
    const response = await GET(request("minWrongCount=3&maxWrongCount=5"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.page).toHaveBeenCalledWith({ filters: { datasetId: "", level: "all", query: "", minWrongCount: 3, maxWrongCount: 5, sort: "count" }, cursor: null }, student);
    expect(mocks.session).toHaveBeenCalledOnce();
  });
  it.each(["studentId=other", "minWrongCount=0", "minWrongCount=", "minWrongCount=4&maxWrongCount=2", "query=a&query=b"])("위조/잘못된 조건을거절한다: %s", async query => {
    const response = await GET(request(query)); expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.page).not.toHaveBeenCalled();
  });
  it("미인증/인증장애/없음/조회장애를구별한다", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    mocks.session.mockRejectedValueOnce(new AuthenticationUnavailableError());
    expect((await GET(request())).status).toBe(503);
    mocks.page.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("database secret"));
    expect((await GET(request())).status).toBe(404);
    const failure = await GET(request()); expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: "단어를 불러오지 못했습니다. 다시 시도해 주세요." });
  });
  it("다른학생커서는409,조건커서는400으로복구를구별한다", async () => {
    mocks.page.mockRejectedValueOnce(new WrongWordCursorError("identity")).mockRejectedValueOnce(new WrongWordCursorError());
    for (const status of [409, 400]) { const response = await GET(request()); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); }
  });
  it("현재와 과거는 새 뜻별 조회에 전달하고 자료 변경은409로 알린다", async () => {
    mocks.mistakes.mockResolvedValueOnce({view:'history',stateVersion:'4',items:[]}).mockRejectedValueOnce(new MistakeReadError('changed'));
    expect((await GET(request('view=history'))).status).toBe(200);
    expect(mocks.mistakes).toHaveBeenCalledWith({filters:expect.objectContaining({view:'history'}),cursor:null},student);
    expect(mocks.page).not.toHaveBeenCalled();expect((await GET(request('view=current'))).status).toBe(409);
    expect((await GET(request('view=invalid'))).status).toBe(400);
  });
});
