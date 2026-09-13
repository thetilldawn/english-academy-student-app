import { beforeEach, expect, it, vi } from "vitest";
import { fakeSchoolBundle as bundle } from "../../school-schedule.fixture";
const mocks=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn(),read:vi.fn(),overview:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/auth/admin",()=>({getAdminContextOrThrow:mocks.admin}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc})}));
vi.mock("../queries/school-schedule-editor-query",()=>({readSchoolScheduleEditor:mocks.read}));
vi.mock("../queries/school-schedule-query",()=>({getAdminSchoolScheduleOverview:mocks.overview}));
import { saveSchoolScheduleEventAction,readSchoolScheduleSaveResultAction,readSchoolScheduleEditorAction } from "./school-schedule-edit-actions";
const input={requestId:"00000000-0000-4000-8000-000000000111",schoolKey:bundle.schoolKey,academicYear:2026,semester:2,sourceVersionId:bundle.versionId,manualRevision:0,
  event:{...bundle.events[0],sourceUrl:null,sourceLabel:"관리자 수동 입력"}};
beforeEach(()=>{vi.resetAllMocks();mocks.admin.mockResolvedValue({userId:"fake-admin"});});
it("현재 관리자 인증 전에 저장·결과·학교 자료를 읽지 않는다",async()=>{
  mocks.admin.mockResolvedValue(null);
  for(const action of [saveSchoolScheduleEventAction,readSchoolScheduleSaveResultAction,readSchoolScheduleEditorAction]) expect(await action(input)).toMatchObject({ok:false,status:401});
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
});
it("잘못된 입력과 원천 링크 위조를 DB 호출 전에 거절한다",async()=>{
  expect(await saveSchoolScheduleEventAction({...input,event:{...input.event,startDate:"2026-02-31"}})).toMatchObject({ok:false,status:400});
  expect(await saveSchoolScheduleEventAction({...input,event:{...input.event,sourceUrl:"https://school.example.invalid"}})).toMatchObject({ok:false,status:400});
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("정상 영수증만 성공으로 받고 타 범위·응답 오류는 불명으로 처리한다",async()=>{
  const receipt={requestId:input.requestId,schoolKey:input.schoolKey,academicYear:2026,semester:2,eventId:input.event.id,revision:1};
  mocks.rpc.mockResolvedValue({data:receipt,error:null});expect(await saveSchoolScheduleEventAction(input)).toEqual({ok:true,receipt});
  mocks.rpc.mockResolvedValue({data:{...receipt,schoolKey:"J10:8888888"},error:null});
  expect(await saveSchoolScheduleEventAction(input)).toMatchObject({ok:false,outcome:"unknown"});
});
it("버전 충돌과 내부 장애를 구분하고 내부 원문을 노출하지 않는다",async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:"40001",message:"private data"}});
  expect(await saveSchoolScheduleEventAction(input)).toMatchObject({ok:false,status:409});
  mocks.rpc.mockRejectedValue(new Error("SECRET"));
  const result=await saveSchoolScheduleEventAction(input);expect(result).toMatchObject({outcome:"unknown"});expect(JSON.stringify(result)).not.toContain("SECRET");
});
it("저장 결과 조회는 읽기 RPC만 쓰고 아직 없는 결과를 실패로 확정하지 않는다",async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:null});expect(await readSchoolScheduleSaveResultAction({requestId:input.requestId})).toEqual({ok:true,receipt:null});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_admin_school_schedule_edit_result_v1",{p_request_id:input.requestId});
});
