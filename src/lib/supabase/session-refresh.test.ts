import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuthSafeFetch } from "./auth-fetch";
import { awaitWithAbortSignal, createRequestDeadline } from "@/lib/network/request-policy";

const cookieName="sb-test-auth-token";
const user={id:"00000000-0000-4000-8000-000000000001"};
function fixture(transport:typeof fetch,signal?:AbortSignal){
  const value="base64-"+Buffer.from(JSON.stringify({access_token:"fake-expired-token",refresh_token:"fake-refresh-token",expires_at:Math.floor(Date.now()/1000)-30,token_type:"bearer",user})).toString("base64url");
  const jar=new Map([[cookieName,value]]);
  const setAll=vi.fn((values:Array<{name:string;value:string;options:Record<string,unknown>}>)=>{for(const cookie of values){if(cookie.options.maxAge===0) jar.delete(cookie.name);else jar.set(cookie.name,cookie.value);}});
  const client=createServerClient("https://test.supabase.co","fake-key",{global:{fetch:createAuthSafeFetch("https://test.supabase.co",signal,transport)},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll}});
  return {client,jar,setAll,value};
}
function success(){return Response.json({access_token:"fake-fresh-token",refresh_token:"fake-new-refresh-token",expires_in:3600,token_type:"bearer",user});}
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(console,"error").mockImplementation(()=>undefined);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it("만료토큰 갱신5초초과 뒤 쿠키를 보존하고 추가 실제전송을 막는다",async()=>{
  const deadline=createRequestDeadline(5000);
  const transport=vi.fn<typeof fetch>((_input,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true});}));
  const f=fixture(transport,deadline.signal);
  const work=f.client.auth.getSession();
  const outer=expect(awaitWithAbortSignal(work,deadline.signal)).rejects.toMatchObject({name:"AbortError"});
  await vi.advanceTimersByTimeAsync(5000);
  await outer;
  expect(f.jar.get(cookieName)).toBe(f.value);
  await vi.runAllTimersAsync();
  await work;
  expect(transport).toHaveBeenCalledTimes(1);
  expect(f.setAll.mock.calls.flatMap(([cookies])=>cookies).some(c=>c.options.maxAge===0)).toBe(false);
  expect(f.jar.get(cookieName)).toBe(f.value);
  deadline.dispose();

  // A later request can refresh the same retained cookie, without a fresh login.
  const resumed=fixture(vi.fn(async()=>success()));
  expect((await resumed.client.auth.getSession()).data.session).not.toBeNull();
  expect(resumed.jar.get(cookieName)).not.toBe(resumed.value);
});
it.each([408,429,509])("외부 인증 응답%d 후 정상 갱신하면 세션을 지우지 않는다",async(status)=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({message:"temporary"},{status})).mockImplementation(async()=>success());
  const f=fixture(transport);
  const result=f.client.auth.getSession();
  await vi.runAllTimersAsync();
  expect((await result).data.session).not.toBeNull();
  expect(f.setAll.mock.calls.flatMap(([cookies])=>cookies).some(c=>c.options.maxAge===0)).toBe(false);
  expect(transport).toHaveBeenCalledTimes(2);
});
it("실제 refresh token 거절에는 기존 세션 제거를 유지한다",async()=>{
  const f=fixture(vi.fn(async()=>Response.json({code:"refresh_token_not_found",message:"Invalid Refresh Token"},{status:400})));
  await f.client.auth.getSession();
  expect(f.jar.has(cookieName)).toBe(false);
});
