import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/auth/student-session",()=>({getStudentSession:mocks.session}));
vi.mock("@/features/students/public-server",async()=>({getOwnMistakeEpisodeHistory:mocks.read,
  MistakeReadError:(await import("@/features/students/server/queries/mistake-episode-query")).MistakeReadError}));
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
import { GET } from "./route";
const student={studentId:"fake",sessionId:"fake-session"},identity=studentNotebookCacheIdentity(student);
const query=`meaningKey=${"a".repeat(64)}&upperVersion=7&cursor=opaque`;
const request=(params=query,scope=identity)=>new Request(`https://example.test/api/student/notebook/episodes?${params}`,{headers:{"x-student-notebook-identity":scope}});
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue(student);mocks.read.mockResolvedValue({items:[]});});
describe("학생 뜻별 이력 API",()=>{
  it("현재 본인 세션만 전달하고 개인 이력을 저장하지 않는다",async()=>{
    const response=await GET(request());expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledWith({meaningKey:"a".repeat(64),upperVersion:"7",cursor:"opaque"},student);
    expect(await response.json()).toEqual({page:{items:[]},identity});
  });
  it("미인증·옛 세션·위조 조건을 조회 전에 거절한다",async()=>{
    mocks.session.mockResolvedValueOnce(null);expect((await GET(request())).status).toBe(401);
    expect((await GET(request(query,"old"))).status).toBe(401);
    for(const params of [query+"&studentId=other",query+"&upperVersion=8",query.replace("upperVersion=7","upperVersion=9223372036854775808"),"meaningKey=bad"])
      expect((await GET(request(params))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("없는 기록과 장애를 구별하고 내부 오류는 보내지 않는다",async()=>{
    mocks.read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("private database message"));
    expect((await GET(request())).status).toBe(404);const response=await GET(request());expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database");
  });
});
