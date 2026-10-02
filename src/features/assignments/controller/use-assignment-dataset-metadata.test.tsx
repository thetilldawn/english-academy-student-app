// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { DatasetOption } from "@/lib/admin/dataset-summary";
import type { AssignmentDatasetItem } from "../catalog-types";
import { useAssignmentDatasetMetadata } from "./use-assignment-dataset-metadata";
import { useAssignmentDatasetDirectory } from "./use-assignment-dataset-directory";
import { loadAssignmentDatasetDirectory } from "../transport/assignment-workspace-reads";
vi.mock("../transport/assignment-workspace-reads",()=>({loadAssignmentDatasetDirectory:vi.fn()}));
const base:AssignmentDatasetItem={...cataloguedDatasetFromMetadata({id:"fake",title:"기존 이름"},undefined),templateKind:"other",isActive:true,status:"ready",rowCount:4,availableQuestionModes:["book_meaning_choice"]};
const fresh:DatasetOption={...base,title:"새 이름",displayName:"새 이름",templateKind:"performance_assessment",schoolName:null,semester:null,isAssignable:false};
const delayed=()=>{let resolve!:(value:DatasetOption[])=>void;const promise=new Promise<DatasetOption[]>(r=>{resolve=r;});return{promise,resolve};};
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("changes display fields only and preserves availability and the selected content",async()=>{
  const refresh=vi.fn().mockResolvedValue([fresh]);const hook=renderHook(()=>useAssignmentDatasetMetadata([base],true,refresh));
  await act(async()=>hook.result.current.refreshMetadata());
  expect(hook.result.current.datasets[0]).toMatchObject({title:"새 이름",templateKind:"performance_assessment",schoolName:null,semester:null,isAssignable:true,isActive:true,status:"ready",rowCount:4,availableQuestionModes:["book_meaning_choice"]});
  expect(base.title).toBe("기존 이름");
});
it("rejects failed refreshes and leaves existing display information recoverable",async()=>{
  const refresh=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([fresh]);const hook=renderHook(()=>useAssignmentDatasetMetadata([base],true,refresh));
  await act(async()=>{await expect(hook.result.current.refreshMetadata()).rejects.toThrow("offline");});expect(hook.result.current.datasets).toEqual([base]);
  await act(async()=>hook.result.current.refreshMetadata());expect(hook.result.current.datasets[0]!.title).toBe("새 이름");
});
it.each(["close","disable"])("discards an old refresh after %s",async(mode)=>{
  const pending=delayed();const refresh=vi.fn().mockReturnValue(pending.promise);const hook=renderHook(({enabled})=>useAssignmentDatasetMetadata([base],enabled,refresh),{initialProps:{enabled:true}});
  let task!:Promise<void>;act(()=>{task=hook.result.current.refreshMetadata();});const signal=refresh.mock.calls[0]![0] as AbortSignal;
  if(mode==="close")hook.unmount();else hook.rerender({enabled:false});expect(signal.aborted).toBe(true);
  await act(async()=>{pending.resolve([fresh]);await expect(task).rejects.toMatchObject({name:"AbortError"});});
  expect(hook.result.current.datasets).toEqual([base]);
});
it("updates the parent directory only after a current successful metadata refresh",async()=>{
  const load=vi.mocked(loadAssignmentDatasetDirectory),pending=delayed();load.mockImplementationOnce(async()=>({datasets:await pending.promise}));
  const hook=renderHook(()=>useAssignmentDatasetDirectory()),abort=new AbortController();let task!:Promise<DatasetOption[]>;
  act(()=>{task=hook.result.current.actions.refreshMetadata(abort.signal);});abort.abort();
  await act(async()=>{pending.resolve([fresh]);await expect(task).rejects.toMatchObject({name:"AbortError"});});expect(hook.result.current.datasets).toEqual([]);
  load.mockRejectedValueOnce(new Error("retryable"));await act(async()=>{await expect(hook.result.current.actions.refreshMetadata(new AbortController().signal)).rejects.toThrow("retryable");});
  load.mockResolvedValueOnce({datasets:[fresh]});await act(async()=>{await hook.result.current.actions.refreshMetadata(new AbortController().signal);});expect(hook.result.current.datasets).toEqual([fresh]);
});
