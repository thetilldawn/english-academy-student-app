import { expect,it,vi } from "vitest";
import { createAuthSafeFetch } from "./auth-fetch";
it.each([408,429,500,509,599])("인증서버의 일시 실패%d는 재시도 가능으로 분류한다",async(status)=>{
  const fetcher=createAuthSafeFetch("https://example.invalid",undefined,vi.fn(async()=>new Response(null,{status})));
  await expect(fetcher("https://example.invalid/auth/v1/token")).rejects.toMatchObject({name:"AuthRetryableFetchError",status});
});
it.each([400,401,403])("실제 인증 거절%d는 바꾸지 않는다",async(status)=>{
  const fetcher=createAuthSafeFetch("https://example.invalid",undefined,vi.fn(async()=>new Response(null,{status})));
  expect((await fetcher("https://example.invalid/auth/v1/token")).status).toBe(status);
});
it("업무 RPC 실패를 인증오류로 바꾸지 않는다",async()=>{
  const fetcher=createAuthSafeFetch("https://example.invalid",undefined,vi.fn(async()=>new Response(null,{status:429})));
  expect((await fetcher("https://example.invalid/rest/v1/rpc/example")).status).toBe(429);
});
it("다른 서버의 비슷한 경로는 바꾸지 않는다",async()=>{
  const fetcher=createAuthSafeFetch("https://example.invalid",undefined,vi.fn(async()=>new Response(null,{status:429})));
  expect((await fetcher("https://another.invalid/auth/v1/token")).status).toBe(429);
});
