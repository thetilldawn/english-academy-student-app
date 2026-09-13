import { expect, it } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { buildSchoolSummary, nearestSchoolExam } from "./school-schedule";
import { schoolTimeline } from "./school-timeline";
import { schoolScheduleSummarySchema } from "../contracts/school-schedule";
const summary=buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고2"},[bundle],"2026-09-14");
it("이어지는 중첩 기간은 한 묶음, 겹치지 않는 이후 날짜는 별도 묶음이다",()=>{
  const event=summary.events[0];
  const events=[event,{...event,id:"p1",kind:"performance" as const,startDate:"2026-10-14",endDate:"2026-10-18"},
    {...event,id:"p2",startDate:"2026-10-18",endDate:"2026-10-18"},{...event,id:"later",startDate:"2026-10-19",endDate:"2026-10-19"}];
  const result=schoolTimeline({status:"ready",today:summary.today,groups:[{summary:{...summary,events},studentCount:2}]});
  expect(result.clusters.map(c=>[c.startDate,c.endDate,c.entries.length])).toEqual([["2026-10-12","2026-10-18",3],["2026-10-19","2026-10-19",1]]);
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
