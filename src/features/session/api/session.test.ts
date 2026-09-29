import { afterEach, expect,it,vi } from "vitest";
import { requestStudentSessionRenewal } from "./session";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it.each(["headers","body"])("학생 갱신 %s가 멈춰도 재시도가 가능해진다",async(part)=>{
  vi.useFakeTimers();
  vi.stubGlobal("fetch",vi.fn(()=>part==="headers"?new Promise(()=>{}):Promise.resolve({status:200,ok:true,json:()=>new Promise(()=>{})})));
  const result=requestStudentSessionRenewal(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(7000);
  expect(await result).toEqual({status:"retry"});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({nextCheckInMilliseconds:86400000})));
  expect(await requestStudentSessionRenewal(new AbortController().signal)).toEqual({status:"ok",nextCheckInMilliseconds:86400000});
});
it("실제401만 invalid이고503은 retry다",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(new Response(null,{status:401})).mockResolvedValueOnce(new Response(null,{status:503})));
  expect(await requestStudentSessionRenewal(new AbortController().signal)).toEqual({status:"invalid"});
  expect(await requestStudentSessionRenewal(new AbortController().signal)).toEqual({status:"retry"});
});
it("화면이 떠나며 취소하면 재시도 예약을 하지 않는다",async()=>{
  const controller=new AbortController();controller.abort();
  vi.stubGlobal("fetch",vi.fn(async()=>{throw new DOMException("aborted","AbortError");}));
  expect(await requestStudentSessionRenewal(controller.signal)).toEqual({status:"aborted"});
});
