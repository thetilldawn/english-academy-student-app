import { afterEach, expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({jar:new Map<string,string>(),set:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({getAll:()=>[...mocks.jar].map(([name,value])=>({name,value})),set:(name:string,value:string,options:{maxAge?:number})=>{mocks.set(name,value,options);if(options.maxAge===0)mocks.jar.delete(name);else mocks.jar.set(name,value);}})}));
vi.mock("@/lib/env",()=>({getPublicEnvironment:()=>({NEXT_PUBLIC_SUPABASE_URL:"https://test.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"fake-key"})}));
import { signOutAdminSession } from "./server";
function seed(expired=false){
  mocks.jar.clear();mocks.set.mockClear();
  mocks.jar.set("sb-test-auth-token","base64-"+Buffer.from(JSON.stringify({access_token:"fake-valid-token",refresh_token:"fake-refresh-token",expires_at:Math.floor(Date.now()/1000)+(expired?-30:3600),token_type:"bearer",user:{id:"00000000-0000-4000-8000-000000000001"}})).toString("base64url"));
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it("실제 SDK가 로그아웃 실패에 삭제를 요청해도 쿠키는 보존하고 재시도한다",async()=>{
  seed();vi.spyOn(console,"error").mockImplementation(()=>undefined);
  const original=mocks.jar.get("sb-test-auth-token");
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({message:"temporary"},{status:503})).mockResolvedValueOnce(new Response(null,{status:204}));
  vi.stubGlobal("fetch",transport);
  expect((await signOutAdminSession()).error).not.toBeNull();
  expect(mocks.jar.get("sb-test-auth-token")).toBe(original);
  expect(mocks.set).not.toHaveBeenCalled();
  expect((await signOutAdminSession()).error).toBeNull();
  expect(mocks.jar.has("sb-test-auth-token")).toBe(false);
  expect(transport).toHaveBeenCalledTimes(2);
});
it("이미 원격에서 무효화된 세션도 로컬 쿠키를 정리한다",async()=>{
  seed();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({message:"not authenticated"},{status:401})));
  expect((await signOutAdminSession()).error).toBeNull();
  expect(mocks.jar.size).toBe(0);
});
it.each(["modern","legacy"])("만료 access token과 실제 무효 refresh token은 계속503으로 남기지 않는다: %s",async(format)=>{
  seed(true);vi.spyOn(console,"error").mockImplementation(()=>undefined);
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({code:"refresh_token_not_found",error_code:"refresh_token_not_found",message:"Invalid Refresh Token"},{status:400,...(format==="modern"?{headers:{"X-Supabase-Api-Version":"2024-01-01"}}:{})})));
  expect((await signOutAdminSession()).error).toBeNull();
  expect(mocks.jar.size).toBe(0);
});
