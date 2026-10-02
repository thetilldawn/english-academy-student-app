import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),word:vi.fn()}));
vi.mock("@/lib/auth/student-session",()=>({getStudentSession:mocks.session}));
vi.mock("@/features/students/public-server",async()=>({getMistakeStudyWord:mocks.word,
  MistakeReadError:(await import("@/features/students/server/queries/mistake-episode-query")).MistakeReadError}));
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
import { GET } from "./route";
const student={studentId:"fake-student",sessionId:"fake-session"};
const identity=studentNotebookCacheIdentity(student),context={params:Promise.resolve({id:"fake-token"})};
const request=(query="",scope=identity)=>new Request("https://example.test/api/student/notebook/fake-token?"+query,{headers:{"x-student-notebook-identity":scope}});
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue(student);mocks.word.mockResolvedValue({key:"word:fake"});});
describe("학생 단어 상세 재확인",()=>{
  it("현재 로그인한 본인과 조회 상한으로만 읽고 응답은 저장하지 않는다",async()=>{
    const response=await GET(request("view=history&upperVersion=7"),context);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.word).toHaveBeenCalledWith("fake-token","history","7",student);
    expect(await response.json()).toEqual({identity,word:{key:"word:fake"}});
  });
  it("옛 세션의 상세는 본문을 읽기 전에 차단한다",async()=>{
    expect((await GET(request("","old-session"),context)).status).toBe(401);expect(mocks.word).not.toHaveBeenCalled();
  });
  it.each(["studentId=other","view=no","upperVersion=9223372036854775808","view=current&view=history"])("위조 조건 %s를 거절한다",async query=>{
    expect((await GET(request(query),context)).status).toBe(400);expect(mocks.word).not.toHaveBeenCalled();
  });
  it("사라진 현재 오답과 조회 실패를 구별한다",async()=>{
    mocks.word.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("private database details"));
    expect((await GET(request(),context)).status).toBe(404);
    const response=await GET(request(),context);expect(response.status).toBe(503);expect(await response.text()).not.toContain("private database");
  });
});
