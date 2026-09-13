import { describe, expect, it } from "vitest";
import { schoolScheduleBundleSchema } from "../contracts/school-schedule";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { buildSchoolSummary, nearestSchoolExam, scheduleWeek, schoolToday } from "./school-schedule";
const profile = { schoolKey: bundle.schoolKey, schoolName: bundle.schoolName, gradeLabel: "고2" };
const summary = (today: string) => buildSchoolSummary(profile, [bundle], today);
describe("학교 날짜 계산", () => {
  it("한국 자정 전후를 날짜 문자열로 계산한다", () => {
    expect(schoolToday(new Date("2026-09-12T14:59:59Z"))).toBe("2026-09-12");
    expect(schoolToday(new Date("2026-09-12T15:00:00Z"))).toBe("2026-09-13");
    expect(nearestSchoolExam(summary("2026-09-13"))?.label).toBe("2-1 | 29일 [4.1주]");
  });
  it.each(["2026-10-12","2026-10-14","2026-10-16"])("시험기간 %s에는 진행 중으로 유지한다", today => {
    expect(nearestSchoolExam(summary(today))?.label).toBe("2-1 | 시험 중");
  });
  it("끝난 시험과 고3 미실시를 다음 시험으로 계산하지 않는다", () => {
    expect(nearestSchoolExam(summary("2026-10-17"))).toBeNull();
    const third = buildSchoolSummary({ ...profile, gradeLabel: "고3" }, [bundle], "2026-09-13");
    expect(third.events.filter(event => event.kind === "written")).toHaveLength(1);
    expect(third.events[0].status).toBe("not-held"); expect(nearestSchoolExam(third)?.exam.kind).toBe("csat");
  });
  it("등록 누락·학교 미연결·자료 없음·다른 학교급/연도를 구별한다", () => {
    expect(buildSchoolSummary({...profile,gradeLabel:null},[bundle],"2026-09-13").status).toBe("missing-profile");
    expect(buildSchoolSummary({...profile,schoolKey:null},[bundle],"2026-09-13").status).toBe("unlinked");
    expect(buildSchoolSummary({...profile,gradeLabel:"중2"},[bundle],"2026-09-13").status).toBe("unregistered");
    expect(buildSchoolSummary(profile,[bundle],"2027-09-13").status).toBe("unregistered");
  });
  it("이전 학기의 날짜 없는 수행은 이번 학기와 섞지 않는다", () => {
    expect(buildSchoolSummary(profile,[{...bundle,semester:1,versionId:"old",events:[{...bundle.events[1],id:"old"}]},bundle],"2026-09-13").events.some(event=>event.id==="old")).toBe(false);
  });
  it("자료를 미리 검토해도 가까운 1학기 시험을 누락하지 않는다", () => {
    const first = {...bundle,semester:1,checkedOn:"2026-04-01",versionId:"first",events:[{...bundle.events[0],id:"June",startDate:"2026-06-20",endDate:"2026-06-23"}]};
    const second = {...bundle,checkedOn:"2026-06-01"};
    const result = buildSchoolSummary(profile,[first,second],"2026-06-10");
    expect(nearestSchoolExam(result)?.exam.id).toBe("June");
    expect(buildSchoolSummary(profile,[{...bundle,semester:1}],"2026-09-13").events.some(event=>event.kind==="performance")).toBe(false);
  });
  it("요일·연도 경계에서도 월요일 시작 주를 찾는다", () => {
    expect(scheduleWeek("2026-10-18")).toBe("2026-10-12");
    expect(scheduleWeek("2027-01-01")).toBe("2026-12-28");
  });
  it("미확인 날짜의 조작·역전된 기간·중복 식별자를 거절한다", () => {
    const invalid = [ {...bundle.events[1],startDate:"2026-09-13"}, {...bundle.events[0],endDate:"2026-10-11"} ];
    for (const event of invalid) expect(schoolScheduleBundleSchema.safeParse({...bundle,events:[event]}).success).toBe(false);
    expect(schoolScheduleBundleSchema.safeParse({...bundle,events:[bundle.events[0],bundle.events[0]]}).success).toBe(false);
  });
  it("학교 배부물은 출처명 필수이며 공개 링크 검증을 우회하지 않는다", () => {
    const handout = {...bundle.events[1],sourceUrl:null,sourceLabel:"학교 배부 안내문"};
    expect(schoolScheduleBundleSchema.safeParse({...bundle,events:[handout]}).success).toBe(true);
    for (const event of [
      {...handout,sourceLabel:undefined},{...handout,sourceLabel:" \t "},
      {...handout,sourceUrl:"https://999.999.999.999"},{...handout,sourceUrl:"javascript:alert(1)"},
      {...handout,unexpected:true},
    ]) expect(schoolScheduleBundleSchema.safeParse({...bundle,events:[event]}).success).toBe(false);
  });
});
