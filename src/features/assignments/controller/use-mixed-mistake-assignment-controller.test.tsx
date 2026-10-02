// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { AssignmentDatasetItem, AssignmentStudentItem, AssignmentUnitItem } from "../catalog-types";
import type { AssignmentTransport, AssignmentTransportResponse } from "../transport/assignment-transport";
import { useMixedMistakeAssignmentController } from "./use-mixed-mistake-assignment-controller";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const dataset:AssignmentDatasetItem={...cataloguedDatasetFromMetadata({id:id(1),title:"검사 단어장"},undefined),isActive:true,isAssignable:true,status:"ready",rowCount:100};
const student={id:id(2),displayName:"가짜 학생",schoolName:"가짜중",gradeLabel:"중1",status:"active",currentVocabDatasetId:id(1)} as AssignmentStudentItem;
const units=[1,2].map(n=>({id:id(n+2),datasetId:id(1),sortIndex:n,displayName:`DAY ${n}`,entryCount:50})) as AssignmentUnitItem[];
const clock=()=>Date.parse("2026-10-02T00:00:00Z");
function preview(){return {planVersion:"meaning-episode-v1",selectionFingerprint:"a".repeat(64),totalQuestionCount:20,primaryQuestionCount:16,reviewMeaningCount:4,availablePrimaryCount:96,candidateReviewCount:5,unavailableCount:1,
  unavailableItems:[{key:"x",headword:"word",reason:"현재 출제할 수 없습니다."}],error:null,
  banks:[0,1].map(index=>({index,questionCount:10,primaryQuestionCount:8,reviewMeaningCount:2,quizContentMode:"book",englishToKoreanRatio:50,timeLimitSeconds:150}))};}
const saved={planVersion:"meaning-episode-v1",kind:"mistake_batch",assignments:[5,6].map(n=>({studentId:student.id,assignmentId:id(n),questionCount:10}))};
function options(transport:AssignmentTransport){return {audienceMode:"single" as const,student,datasets:[dataset],units,enabled:true,previewDelayMs:0,transport,clock};}
const goodPreview=()=>({data:preview(),ok:true,status:200});
async function confirm(result:{current:ReturnType<typeof useMixedMistakeAssignmentController>}){
  await waitFor(()=>expect(result.current.value).not.toBeNull());
  act(()=>{result.current.confirmExclusions(true);result.current.confirmBanks(true);});
  expect(result.current.canSubmit).toBe(true);
}
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe("혼합 배정의 미리보기와 정확한 저장 요청 보존",()=>{
  it.each(["passingScore","timing"] as const)("%s 변경은 같은 source 확인값이어도 동의를 다시 받는다",async field=>{
    let writes=0,reads=0;
    const transport:AssignmentTransport=vi.fn(async request=>{if(request.url.endsWith('/preview')){reads++;return goodPreview();}writes++;return {data:saved,ok:true,status:201};});
    const {result}=renderHook(()=>useMixedMistakeAssignmentController(options(transport)));
    await confirm(result);
    act(()=>result.current.dispatch({type:"exam/changed",exam:{...result.current.draft.exam,...(field==='passingScore'?{passingScore:90}:{timing:{mode:"total",totalSeconds:400}})}}));
    expect(result.current.canSubmit).toBe(false);
    await waitFor(()=>expect(reads).toBe(2));await waitFor(()=>expect(result.current.preview.status).toBe('ready'));
    expect(result.current.exclusionsConfirmed).toBe(false);expect(result.current.banksConfirmed).toBe(false);
    await confirm(result);await act(async()=>{expect((await result.current.submit()).ok).toBe(true);});
    expect(result.current.succeeded).toBe(true);expect(writes).toBe(1);
  });
  it.each([503,201])("%i 불확실 응답은 입력을 잠그고 마감이 지나도 같은 요청으로 복구한다",async status=>{
    const requests:unknown[]=[];let now=clock();
    const transport:AssignmentTransport=vi.fn(async request=>{if(request.url.endsWith('/preview'))return goodPreview();requests.push(request.body);
      return requests.length===1?{data:{assignmentId:id(5)},ok:status===201,status}:{data:saved,ok:true,status:201};});
    const {result}=renderHook(()=>useMixedMistakeAssignmentController({...options(transport),clock:()=>now}));
    act(()=>result.current.dispatch({type:"deadline/changed",deadline:{mode:"at",koreanLocalDateTime:"2026-10-02T12:00"}}));
    await confirm(result);await act(async()=>{expect((await result.current.submit()).ok).toBe(false);});
    expect(result.current.uncertain).toBe(true);const draft=result.current.draft;
    act(()=>{result.current.dispatch({type:"questionCount/manuallyChanged",value:30});result.current.retryPreview();});
    expect(result.current.draft).toBe(draft);now+=86_400_000;
    await act(async()=>{expect((await result.current.recover()).ok).toBe(true);});
    expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(result.current.succeeded).toBe(true);
  });
  it.each([401,403])("복구 중 %i는 이전 요청과 잠금을 유지한다",async status=>{
    const writes:unknown[]=[];
    const transport:AssignmentTransport=vi.fn(async req=>{if(req.url.endsWith('/preview'))return goodPreview();writes.push(req.body);return writes.length===1?{ok:false,status:503,data:{}}:writes.length===2?{ok:false,status,data:{}}:{ok:true,status:201,data:saved};});
    const {result}=renderHook(()=>useMixedMistakeAssignmentController(options(transport)));await confirm(result);
    await act(async()=>{await result.current.submit();});await act(async()=>{await result.current.recover();});expect(result.current.uncertain).toBe(true);
    await act(async()=>{expect((await result.current.recover()).ok).toBe(true);});expect(writes[1]).toEqual(writes[0]);expect(writes[2]).toEqual(writes[0]);
  });
  it("오답 변경 409는 새 미리보기와 재동의를 요구한다",async()=>{
    let reads=0;const transport:AssignmentTransport=vi.fn(async req=>{if(req.url.endsWith('/preview')){reads++;return goodPreview();}return {ok:false,status:409,data:{code:'source_changed',error:'오답이 바뀌었습니다.'}};});
    const {result}=renderHook(()=>useMixedMistakeAssignmentController(options(transport)));await confirm(result);
    await act(async()=>{await result.current.submit();});await waitFor(()=>expect(reads).toBe(2));await waitFor(()=>expect(result.current.preview.status).toBe('ready'));
    expect(result.current.canSubmit).toBe(false);expect(result.current.banksConfirmed).toBe(false);
  });
  it("늦은 이전 미리보기와 중복 클릭을 받지 않는다",async()=>{
    const pending:((value:AssignmentTransportResponse)=>void)[]=[];let writes=0;
    const transport:AssignmentTransport=vi.fn(async req=>{if(req.url.endsWith('/preview'))return new Promise<AssignmentTransportResponse>(resolve=>pending.push(resolve));writes++;return {ok:true,status:201,data:saved};});
    const {result}=renderHook(()=>useMixedMistakeAssignmentController(options(transport)));await waitFor(()=>expect(pending).toHaveLength(1));
    act(()=>result.current.dispatch({type:"exam/changed",exam:{...result.current.draft.exam,passingScore:90}}));await waitFor(()=>expect(pending).toHaveLength(2));
    await act(async()=>pending[1](goodPreview()));await confirm(result);
    await act(async()=>pending[0]({ok:false,status:401,data:{}}));expect(result.current.canSubmit).toBe(true);
    await act(async()=>{const results=await Promise.all([result.current.submit(),result.current.submit()]);expect(results.filter(r=>r.ok)).toHaveLength(1);});expect(writes).toBe(1);
  });
  it("연결 객체 교체는 미리보기를 다시 확인하고 저장 중 교체는 원래 응답을 처리한다",async()=>{
    let finish!: (value:AssignmentTransportResponse)=>void;
    const first:AssignmentTransport=vi.fn(async req=>req.url.endsWith('/preview')?goodPreview():new Promise<AssignmentTransportResponse>(resolve=>{finish=resolve;}));
    const second:AssignmentTransport=vi.fn(async req=>req.url.endsWith('/preview')?goodPreview():{ok:true,status:201,data:saved});
    const {result,rerender}=renderHook(({transport})=>useMixedMistakeAssignmentController(options(transport)),{initialProps:{transport:first}});await confirm(result);
    rerender({transport:second});await waitFor(()=>expect(second).toHaveBeenCalled());await waitFor(()=>expect(result.current.preview.status).toBe('ready'));
    expect(result.current.canSubmit).toBe(false);await confirm(result);
    rerender({transport:first});await waitFor(()=>expect(result.current.value).not.toBeNull());await confirm(result);
    let request!:ReturnType<typeof result.current.submit>;act(()=>{request=result.current.submit();});
    await waitFor(()=>expect(finish).toBeTypeOf('function'));rerender({transport:second});
    await act(async()=>{finish({ok:true,status:201,data:saved});expect((await request).ok).toBe(true);});expect(result.current.busy).toBe(false);expect(result.current.succeeded).toBe(true);
  });
  it("일괄 선택의 학생 한 명은 혼합 배정을 요청하지 않는다",async()=>{
    const transport:AssignmentTransport=vi.fn(async()=>goodPreview());
    const {result}=renderHook(()=>useMixedMistakeAssignmentController({...options(transport),audienceMode:'bulk'}));
    await act(async()=>{expect((await result.current.submit()).ok).toBe(false);});expect(transport).not.toHaveBeenCalled();
  });
  it("503 뒤 연결이 바뀌어도 원래 연결과 원래 요청으로 저장을 복구한다",async()=>{
    const writes:unknown[]=[];
    const original:AssignmentTransport=vi.fn(async req=>{if(req.url.endsWith('/preview'))return goodPreview();writes.push(req.body);return writes.length===1?{ok:false,status:503,data:{}}:{ok:true,status:201,data:saved};});
    const replacement:AssignmentTransport=vi.fn(async()=>({ok:false,status:403,data:{}}));
    const {result,rerender}=renderHook(({transport})=>useMixedMistakeAssignmentController(options(transport)),{initialProps:{transport:original}});
    await confirm(result);await act(async()=>{await result.current.submit();});expect(result.current.uncertain).toBe(true);
    rerender({transport:replacement});await act(async()=>{expect((await result.current.recover()).ok).toBe(true);});
    expect(replacement).not.toHaveBeenCalled();expect(writes[1]).toEqual(writes[0]);
  });
  it("같은 이벤트에서 여러 범위를 선택해도 앞 선택을 잃지 않는다",()=>{
    const {result}=renderHook(()=>useMixedMistakeAssignmentController(options(vi.fn(async()=>goodPreview()))));
    act(()=>{result.current.toggleAllUnits(false);result.current.toggleUnit(id(3));result.current.toggleUnit(id(4));});
    expect(result.current.draft.range.orderedUnitIds).toEqual([id(3),id(4)]);
  });
});
