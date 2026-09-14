import { expect, it } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { buildSchoolSummary, nearestSchoolExam } from "./school-schedule";
import { schoolTimeline } from "./school-timeline";
import { schoolScheduleSummarySchema } from "../contracts/school-schedule";
const summary=buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고2"},[bundle],"2026-09-14");
it("이어지는 중첩 기간은 한 묶음, 겹치지 않는 이후 날짜는 별도 묶음이다",()=>{
  const event=summary.events[0];
  const events=[{...event,subjectDate:"2026-10-14"},{...event,id:"p1",kind:"performance" as const,startDate:"2026-10-14",endDate:"2026-10-18"},
    {...event,id:"p2",subjectDate:"2026-10-18"},{...event,id:"later",subjectDate:"2026-10-19"}];
  const result=schoolTimeline({status:"ready",today:summary.today,groups:[{summary:{...summary,events},studentCount:2}]});
  expect(result.clusters.map(c=>[c.startDate,c.endDate,c.entries.length])).toEqual([["2026-10-14","2026-10-18",3],["2026-10-19","2026-10-19",1]]);
  expect(result.counts.written).toBe(2); expect(result.counts.performance).toBe(2);
});
it("선택 과목 수강을 임의로 확정 인원에 넣지 않으며 미실시·지난 일정은 제외한다",()=>{
  const result=schoolTimeline({status:"ready",today:summary.today,groups:[{summary,studentCount:5}]});
  expect(result.counts.performance).toBe(0); expect(result.counts.written).toBe(5); expect(result.pending).toHaveLength(1);
});
it("학교키가 없어도 고3 전국 수능은 한 번만 표시하고 대상 인원을 합친다",()=>{
  const senior=buildSchoolSummary({schoolKey:null,schoolName:null,gradeLabel:"고3"},[],"2026-09-14");
  const other=buildSchoolSummary({schoolKey:"J10:8888888",schoolName:"가상 다른고",gradeLabel:"고3"},[],"2026-09-14");
  expect(senior.events[0].title).toBe("2027학년도 수능"); expect(senior.events[0].startDate).toBe("2026-11-19");
  expect(nearestSchoolExam(senior)?.label).toBe("수능 | 66일 [9.4주]");
  expect(schoolScheduleSummarySchema.safeParse(senior).success).toBe(true);
  const result=schoolTimeline({status:"ready",today:senior.today,groups:[{summary:senior,studentCount:2},{summary:other,studentCount:3}]});
  expect(result.clusters[0].entries).toHaveLength(1); expect(result.clusters[0].entries[0].group.studentCount).toBe(5);
  expect(result.counts.csat).toBe(5); expect(senior.events).toHaveLength(1);
});
it("고1·고2와 미확인 다음 학년도에 수능을 생성하지 않는다",()=>{
  for(const gradeLabel of ["고1","고2","중3"]) expect(buildSchoolSummary({schoolKey:null,schoolName:null,gradeLabel},[],"2026-09-14").events).toEqual([]);
  expect(buildSchoolSummary({schoolKey:null,schoolName:null,gradeLabel:"고3"},[],"2027-03-01").events).toEqual([]);
});
it("학교기간은 월별 미정 설명에만 남고 실제 영어일은 단 하루에 배치한다",()=>{
  const event=summary.events[0];
  const unknown=schoolTimeline({status:"ready",today:summary.today,groups:[{summary,studentCount:2}]});
  expect(unknown.clusters).toEqual([]);
  expect(unknown.months.find(month=>month.month==="2026-10")?.pending.map(entry=>entry.event.id)).toEqual([event.id]);
  const actual=schoolTimeline({status:"ready",today:"2026-10-13",groups:[{summary:{...summary,events:[{...event,subjectDate:"2026-10-15"}]},studentCount:2}]});
  expect(actual.clusters.map(cluster=>[cluster.startDate,cluster.endDate])).toEqual([["2026-10-15","2026-10-15"]]);
  expect(actual.clusters[0].entries[0].event.startDate).toBe("2026-10-12");
});
it("월경계 기간과 다음 달의 일정은 월을 먼저 정하고 각각 한 번만 표시한다",()=>{
  const base={...summary.events[1],kind:"performance" as const,precision:"range" as const,status:"confirmed" as const};
  const overview={status:"ready" as const,today:"2026-09-29",groups:[{summary:{...summary,events:[
    {...base,id:"cross",startDate:"2026-09-30",endDate:"2026-10-03"},
    {...base,id:"oct",startDate:"2026-10-01",endDate:"2026-10-01"},
  ]},studentCount:1}]};
  const before=schoolTimeline(overview);
  expect(before.months.map(month=>[month.month,month.clusters.flatMap(cluster=>cluster.entries).map(entry=>entry.event.id)])).toEqual([["2026-09",["cross"]],["2026-10",["oct"]]]);
  const after=schoolTimeline({...overview,today:"2026-10-01"});
  expect(after.months).toHaveLength(1); expect(after.clusters[0].entries.map(entry=>entry.event.id).sort()).toEqual(["cross","oct"]);
});
it("명시된 월·학년도 경계를 적용하되 여러 달이나 월 없는 미정은 추정하지 않는다",()=>{
  const base={...summary.events[1],precision:"week" as const,status:"planned" as const};
  const events=[{...base,id:"jan",dateText:"1월 2주"},{...base,id:"oct",dateText:"10월 4주"},{...base,id:"multi",dateText:"10월 또는 11월"},{...base,id:"none",dateText:"학기 중"}];
  const result=schoolTimeline({status:"ready",today:summary.today,groups:[{summary:{...summary,events},studentCount:1}]});
  expect(result.months.map(month=>month.month)).toEqual(["2026-09","2026-10","2027-01"]);
  expect(result.pending.map(entry=>entry.event.id)).toEqual(["multi","none"]);
  expect(result.clusters).toEqual([]);
});
it("수능 읽기 계약도 별도의 영어 날짜를 허용하지 않는다",()=>{
  const senior=buildSchoolSummary({schoolKey:null,schoolName:null,gradeLabel:"고3"},[],"2026-09-14");
  expect(schoolScheduleSummarySchema.safeParse({...senior,events:[{...senior.events[0],subjectDate:"2026-11-20"}]}).success).toBe(false);
});
it.each(["10~11월", "10-11월", "10·11월", "9, 10월", "9월~10월"])("축약한 여러 달 %s도 한 달로 좁혀 배치하지 않는다",dateText=>{
  const event={...summary.events[1],precision:"month" as const,status:"planned" as const,dateText};
  const result=schoolTimeline({status:"ready",today:summary.today,groups:[{summary:{...summary,events:[event]},studentCount:1}]});
  expect(result.pending).toHaveLength(1); expect(result.months.map(month=>month.month)).toEqual(["2026-09"]);
});
