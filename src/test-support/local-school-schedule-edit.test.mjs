import { expect, it } from "vitest";
import { fixtureResponse, DATA_ORIGIN, PUBLIC_KEY, ACCESS_TOKEN } from "../../scripts/local-admin-baseline-data.mjs";
const requestId="1c42a419-a931-42f1-a651-072df20ac197";
const call=(rpc,input,extra={})=>fixtureResponse({url:DATA_ORIGIN+"/rest/v1/rpc/"+rpc,method:"POST",headers:new Headers({apikey:PUBLIC_KEY,authorization:"Bearer "+ACCESS_TOKEN}),body:JSON.stringify(input),schoolSchedules:true,...extra});
it("브라우저 요청 ID는 가짜 학교 저장·결과 확인에서만 허용한다",()=>{
 const p_input={requestId,schoolKey:"T00:0000001",academicYear:2026,semester:2,sourceVersionId:"local-fake-2026-2",manualRevision:0,event:{id:"manual:"+requestId,title:"가상 일정",grade:1}};
 expect(call("save_admin_school_schedule_event_v1",{p_input},{schoolSchedules:false}).status).toBe(403);
 expect(call("save_admin_school_schedule_event_v1",{p_input:{...p_input,schoolKey:"X00:9999999"}}).status).toBe(403);
 expect(call("save_admin_school_schedule_event_v1",{p_input}).status).toBe(200);
 expect(call("get_admin_school_schedule_edit_result_v1",{p_request_id:requestId}).body.requestId).toBe(requestId);
 expect(call("other_rpc",{p_request_id:requestId}).status).toBe(403);
});
