// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { buildSchoolSummary } from "../domain/school-schedule";
import { SchoolTimeline } from "./school-timeline";
import { SchoolExamIdentity } from "./school-exam-identity";
const summary=buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고2"},[bundle],"2026-09-14");
afterEach(cleanup);
it("유형을 왼쪽 태그로 구별하고 학생 수는 학교 카드 없이 집계한다",()=>{
  render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{summary,studentCount:2}]}} />);
  expect(screen.getByLabelText("평가 유형별 학생 수")).toHaveTextContent("지필 2명");
  expect(screen.queryByText("학교 미등록")).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"10월"}));
  expect(screen.getByText("학교 시험기간")).toBeVisible();expect(screen.getByText("선택 과목")).toBeVisible();
  expect(screen.queryByText("수강 여부 확인 필요")).toBeNull();
  const edit=screen.getByRole("link",{name:"날짜 확인 필요"});
  expect(edit).toHaveAttribute("href",expect.stringContaining("event=fake-P1"));
  expect(screen.getByRole("link",{name:"수동입력"})).toHaveAttribute("href","/admin/school-schedules/edit");
});
it("실패에서는 0건 안내 대신 실제 재시도를 제공한다",()=>{
  render(<SchoolTimeline overview={{status:"error",today:summary.today,groups:[]}} retry={<button>다시 시도</button>} />);
  expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");expect(screen.getByRole("button",{name:"다시 시도"})).toBeVisible();
  expect(screen.queryByText(/일정이 없습니다/)).toBeNull();
});
it("학생 본인에게 편집 링크나 다른 학교 학생 수를 노출하지 않는다",()=>{
  render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{summary,studentCount:1}]}} student studentViewer />);
  expect(screen.queryByRole("link",{name:"수동입력"})).toBeNull();expect(screen.queryByRole("link",{name:"수정"})).toBeNull();
  expect(screen.getAllByText("날짜 확인 필요").length).toBeGreaterThan(0);expect(screen.queryByLabelText("평가 유형별 학생 수")).toBeNull();
});
it("겹친 일정은 한 요소에 나열하고 다음 날짜는 펼침 목록에 둔다",()=>{
  const event=summary.events[0];
  render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{studentCount:2,summary:{...summary,events:[
    {...event,subjectDate:"2026-10-14"},{...event,id:"p",kind:"performance",title:"가상 수행",startDate:"2026-10-14",endDate:"2026-10-14"},
    {...event,id:"later",title:"이후 지필",subjectDate:"2026-12-01"}]}}]}} />);
  expect(screen.getByRole("button",{name:"9월"})).toHaveAttribute("aria-expanded","true");
  expect(screen.getByRole("button",{name:"10월"})).toHaveAttribute("aria-expanded","false");
  expect(screen.getByRole("button",{name:"12월"})).toHaveAttribute("aria-expanded","false");
  fireEvent.click(screen.getByRole("button",{name:"10월"}));
  const first=screen.getByRole("article",{name:"10/14 일정"});expect(within(first).getByText("가상 수행")).toBeVisible();
  expect(within(first).getByText("2학기 1차 시험")).toBeVisible();expect(screen.getByRole("button",{name:"12월"})).toHaveAttribute("aria-expanded","false");
  fireEvent.click(screen.getByRole("button",{name:"10월"}));
  expect(screen.queryByRole("article",{name:"10/14 일정"})).toBeNull();
});
it("수능은 별도 유형과 시행일을 표시하고 이름 배지에 포함한다",()=>{
  const senior=buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고3"},[bundle],"2026-09-14");
  const {container}=render(<><SchoolExamIdentity summary={senior}><strong>가상 학생</strong></SchoolExamIdentity>
    <SchoolTimeline overview={{status:"ready",today:senior.today,groups:[{summary:senior,studentCount:1}]}} /></>);
  fireEvent.click(screen.getByRole("button",{name:"11월"}));
  expect(screen.getByText("2027학년도 수능")).toBeVisible();expect(screen.getByText("수능 | 66일 [9.4주]")).toBeVisible();
  expect(container.textContent!.indexOf("수능 |")).toBeLessThan(container.textContent!.indexOf("가상 학생"));
});
it("주차는 날짜를 만들지 않고 예정 태그와 편집 링크를 표시한다",()=>{
  const event={...summary.events[1],precision:"week" as const,status:"planned" as const,dateText:"10월 4주",sourceUrl:null,sourceLabel:"학교 배부 안내문"};
  render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{summary:{...summary,events:[event]},studentCount:1}]}} />);
  fireEvent.click(screen.getByRole("button",{name:"10월"}));
  expect(screen.getByRole("link",{name:"10월 4주"})).toBeVisible();expect(screen.getByText("예정")).toBeVisible();
  expect(screen.getByText("학교 배부 안내문")).toBeVisible();
});
it("월이 바뀌면 새 당월만 기본으로 열고 같은 달 재조회는 펼침 상태를 유지한다",()=>{
  const props={status:"ready" as const,today:summary.today,groups:[{summary,studentCount:1}]};
  const {rerender}=render(<SchoolTimeline overview={props} />);
  fireEvent.click(screen.getByRole("button",{name:"10월"}));
  rerender(<SchoolTimeline overview={{...props,today:"2026-09-15"}} />);
  expect(screen.getByRole("button",{name:"10월"})).toHaveAttribute("aria-expanded","true");
  rerender(<SchoolTimeline overview={{...props,today:"2026-10-01"}} />);
  expect(screen.getByRole("button",{name:"10월"})).toHaveAttribute("aria-expanded","true");
  expect(screen.queryByRole("button",{name:"9월"})).toBeNull();
});
