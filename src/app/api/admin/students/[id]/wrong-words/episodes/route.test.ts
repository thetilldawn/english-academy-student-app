import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({admin:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/auth/admin",()=>({getAdminContext:mocks.admin}));
vi.mock("@/features/students/server/queries/mistake-episode-history-query",()=>({getAdminMistakeEpisodeHistory:mocks.read}));
import { MistakeReadError } from "@/features/students/server/queries/mistake-episode-query";
import { GET } from "./route";
const admin={userId:"fake-admin"},id="a3030000-0000-4000-8000-000000000001",context={params:Promise.resolve({id})};
const request=(extra="")=>new Request(`https://example.test/api/admin/students/${id}/wrong-words/episodes?meaningKey=${"a".repeat(64)}&upperVersion=7${extra}`);
beforeEach(()=>{vi.resetAllMocks();mocks.admin.mockResolvedValue(admin);mocks.read.mockResolvedValue({items:[]});});
describe("관리자 뜻별 이력 API",()=>{
  it("현재 관리자 권한으로만 학생을 조회한다",async()=>{
    const response=await GET(request(),context);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledWith(id,{meaningKey:"a".repeat(64),upperVersion:"7"},admin);
  });
  it("미인증·잘못된 학생·추가 조건을 조회 전에 거절한다",async()=>{
    mocks.admin.mockResolvedValueOnce(null);expect((await GET(request(),context)).status).toBe(401);
    expect((await GET(request(),{params:Promise.resolve({id:"not-an-id"})})).status).toBe(400);
    expect((await GET(request("&upperVersion=8"),context)).status).toBe(400);expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([["changed",409],["forbidden",403],["unavailable",503]] as const)("%s를 정상 빈 목록으로 바꾸지 않는다",async(reason,status)=>{
    mocks.read.mockRejectedValueOnce(new MistakeReadError(reason));expect((await GET(request(),context)).status).toBe(status);
  });
});
