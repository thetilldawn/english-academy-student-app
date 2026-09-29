import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({admin:vi.fn(),signIn:vi.fn(),signOut:vi.fn(),safeSignOut:vi.fn()}));
vi.mock("@/lib/auth/admin", () => ({ getAdminContext:mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { signInWithPassword:mocks.signIn,signOut:mocks.signOut } }),signOutAdminSession:mocks.safeSignOut }));
import { POST,DELETE } from "./route";
import { AuthenticationUnavailableError } from "@/lib/auth/authentication-error";
const request=()=>new Request("http://localhost/api/admin/session",{method:"POST",headers:{origin:"http://localhost","content-type":"application/json"},body:JSON.stringify({email:"fake@example.invalid",password:"fake-only-password"})});
beforeEach(()=>{vi.clearAllMocks();mocks.admin.mockResolvedValue({userId:"fake-admin",displayName:"가짜 관리자",sessionId:"server-only-session"});mocks.signIn.mockResolvedValue({error:null});mocks.signOut.mockResolvedValue({error:null});mocks.safeSignOut.mockResolvedValue({error:null});});
it("로그인 응답은 표시 필드만 허용하고 서버 세대를 내보내지 않는다", async () => {
  const response = await POST(new Request("http://localhost/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ email: "fake@example.invalid", password: "fake-only-password" }) }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ admin: { userId: "fake-admin", displayName: "가짜 관리자" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("로그인 직후 프로필 조회 장애가 세션을 지우지 않는다",async()=>{
  mocks.admin.mockRejectedValue(new AuthenticationUnavailableError());
  const response=await POST(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("실제 승인되지 않은 관리자는 여전히 로그아웃한다",async()=>{
  mocks.admin.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect(mocks.signOut).toHaveBeenCalledOnce();
});
it.each([408,429,500,509])("로그인서버 실패%d는 비밀번호 오류가 아니다",async(status)=>{
  mocks.signIn.mockResolvedValue({error:{status}});
  expect((await POST(request())).status).toBe(503);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("잘못된 자격증명은401을 유지한다",async()=>{
  mocks.signIn.mockResolvedValue({error:{status:400}});
  expect((await POST(request())).status).toBe(401);
});
it("원격 로그아웃 실패와 성공을 구분한다",async()=>{
  mocks.safeSignOut.mockResolvedValueOnce({error:{status:503}});
  expect((await DELETE(request())).status).toBe(503);
  expect((await DELETE(request())).status).toBe(200);
});
