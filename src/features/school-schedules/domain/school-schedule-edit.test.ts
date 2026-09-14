import { expect, it } from "vitest";
import { draftFromEvent, eventFromDraft } from "./school-schedule-edit";
import { scheduleEditCommandSchema } from "../contracts/school-schedule-edit";
import { fakeSchoolBundle } from "../school-schedule.fixture";
import { schoolEventSchema } from "../contracts/school-schedule";
it("주차·월 예정·날짜 미확인은 가짜 일자를 만들지 않는다",()=>{
  const draft={...draftFromEvent(),title:"가상 영어 발표",precision:"week" as const,dateText:"10월 4주",startDate:"2026-10-01"};
  const result=eventFromDraft(draft,2,"manual:00000000-0000-4000-8000-000000000001");
  expect(result.success).toBe(true);
  if(result.success){expect(result.data.startDate).toBeNull();expect(result.data.endDate).toBeNull();expect(result.data.dateText).toBe("10월 4주");}
});
it("영어 시험일만 입력하거나 학교기간과 함께 입력해도 두 날짜는 각각 보존된다",()=>{
  const original={...fakeSchoolBundle.events[0],subjectDate:"2026-10-15"};
  const restored=eventFromDraft(draftFromEvent(original),2,original.id);
  expect(restored.success).toBe(true);
  if(restored.success) expect([restored.data.subjectDate,restored.data.startDate,restored.data.endDate]).toEqual(["2026-10-15","2026-10-12","2026-10-16"]);
  const only=eventFromDraft({...draftFromEvent(original),precision:"unknown",startDate:"",endDate:""},2,original.id);
  expect(only.success).toBe(true);
  if(only.success) expect([only.data.subjectDate,only.data.startDate,only.data.status]).toEqual(["2026-10-15",null,"unknown"]);
});
it("미실시와 수행 전환은 이전 영어 날짜를 저장하지 않으며 잘못된 원시 날짜를 거절한다",()=>{
  const draft=draftFromEvent({...fakeSchoolBundle.events[0],subjectDate:"2026-10-15"});
  for(const change of [{kind:"performance" as const},{precision:"none" as const}]) {
    const parsed=eventFromDraft({...draft,...change},2,"new");
    expect(parsed.success).toBe(true);
    if(parsed.success) expect(parsed.data.subjectDate ?? null).toBeNull();
  }
  for(const subjectDate of ["2026-02-30","2026-9-1",42]) expect(schoolEventSchema.safeParse({...fakeSchoolBundle.events[0],subjectDate}).success).toBe(false);
  expect(schoolEventSchema.safeParse({...fakeSchoolBundle.events[1],subjectDate:"2026-10-15"}).success).toBe(false);
});
it("하루 입력의 종료일은 같은 날짜이며 잘못된 기간·빈 제목은 검증한다",()=>{
  const draft={...draftFromEvent(),title:"평가",startDate:"2026-09-22",endDate:"2026-09-21"};
  expect(eventFromDraft(draft,2,"new").success).toBe(true);
  expect(eventFromDraft({...draft,precision:"range"},2,"new").success).toBe(false);
  const parsed=eventFromDraft({...draft,title:" "},2,"new");expect(parsed.success).toBe(false);
});
it("원천 링크를 수동 입력의 근거로 위조할 수 없다",()=>{
  const event=eventFromDraft({...draftFromEvent(),title:"평가",startDate:"2026-09-22"},2,"new");
  if(!event.success) throw Error("fixture");
  const command={requestId:"00000000-0000-4000-8000-000000000001",schoolKey:"J10:9999999",academicYear:2026,semester:2,sourceVersionId:null,manualRevision:0,event:event.data};
  expect(scheduleEditCommandSchema.safeParse(command).success).toBe(true);
  expect(scheduleEditCommandSchema.safeParse({...command,event:{...event.data,sourceUrl:"https://school.example.invalid"}}).success).toBe(false);
});
