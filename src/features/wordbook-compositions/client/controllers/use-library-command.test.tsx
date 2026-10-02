// @vitest-environment jsdom
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLibraryCommand } from "./use-library-command";
const send=vi.hoisted(()=>vi.fn());
vi.mock("../transport/library-transport", async original => ({...await original<typeof import("../transport/library-transport")>(),sendLibraryCommandV2:send}));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const command={action:"metadata",protocolVersion:3,templateKind:"other",requestId:id(1),templateId:id(2),expectedRevision:1,
  metadata:{title:"가짜 구성",tags:[],school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:null}} as const;
const request={...command,metadata:{...command.metadata,tags:[]}};
const template={id:id(2),revision:2,templateKind:"other",metadata:request.metadata,latestVersion:{id:id(3),number:1,contentHash:"a".repeat(64),scopeStatus:"confirmed",scopeCount:1,sourceCount:1,includedCount:1,sourceVersionId:null,datasetId:null,createdAt:"2026-10-02T00:00:00Z",hasCriteria:false}};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
beforeEach(()=>{send.mockReset();send.mockResolvedValue({template});});afterEach(cleanup);
it("retries metadata refresh only after the save is confirmed",async()=>{
  const change=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined),result=vi.fn();
  const hook=renderHook(()=>useLibraryCommand(id(9),result,vi.fn(),undefined,change));
  await act(async()=>{await hook.result.current.run(request);});
  expect(hook.result.current.state).toMatchObject({uncertain:true,error:expect.stringContaining("저장은 완료")});
  await act(async()=>{await hook.result.current.run();});
  expect(send).toHaveBeenCalledTimes(1);expect(change).toHaveBeenCalledTimes(2);expect(result).toHaveBeenCalledTimes(1);expect(hook.result.current.state.uncertain).toBe(false);
});
it.each(["unmount","disable","viewer"])("does not start generation after a pending refresh retry and %s",async(mode)=>{
  const wait=deferred(),change=vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(()=>wait.promise);
  const hook=renderHook(({viewer,enabled})=>useLibraryCommand(viewer,vi.fn(),vi.fn(),undefined,change,enabled),{initialProps:{viewer:id(9),enabled:true}});
  await act(async()=>{await hook.result.current.run(request,true,{id:id(4),contentHash:"b".repeat(64)});});
  let retry!:Promise<void>;act(()=>{retry=hook.result.current.run();});
  expect(change).toHaveBeenCalledTimes(2);
  if(mode==="unmount")hook.unmount();else hook.rerender({viewer:mode==="viewer"?id(8):id(9),enabled:mode!=="disable"});
  await act(async()=>{wait.resolve();await retry;});expect(send).toHaveBeenCalledTimes(1);
});
it("generates the selected past version after refreshing metadata and never substitutes latest",async()=>{
  const change=vi.fn().mockResolvedValue(undefined);
  const hook=renderHook(()=>useLibraryCommand(id(9),vi.fn(),vi.fn(),undefined,change));
  await act(async()=>{await hook.result.current.run(request,true,{id:id(4),contentHash:"b".repeat(64)});});
  expect(send).toHaveBeenNthCalledWith(2,expect.objectContaining({action:"materialize",versionId:id(4),contentHash:"b".repeat(64)}),id(9));
});
it("keeps an uncertain original request through a disabled screen",async()=>{
  const wait=deferred();send.mockImplementationOnce(async()=>{await wait.promise;return{template};});const onResult=vi.fn();
  const hook=renderHook(({enabled})=>useLibraryCommand(id(9),onResult,vi.fn(),undefined,undefined,enabled),{initialProps:{enabled:true}});
  let pending!:Promise<void>;act(()=>{pending=hook.result.current.run(request);});hook.rerender({enabled:false});
  await act(async()=>{wait.resolve();await pending;});expect(onResult).not.toHaveBeenCalled();expect(hook.result.current.state.uncertain).toBe(true);
  hook.rerender({enabled:true});await act(async()=>{await hook.result.current.run();});expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
});
