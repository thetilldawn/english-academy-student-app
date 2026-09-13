// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { buildSchoolSummary } from "../domain/school-schedule";
import { SchoolTimeline } from "./school-timeline";
import { SchoolExamIdentity } from "./school-exam-identity";
const summary = buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고2"},[bundle],"2026-09-13");
afterEach(cleanup);
it("같은 주의 학교/학년 일정, 학교 시험기간과 미정 수행을 구별한다", () => {
  render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{summary,studentCount:2}]}} />);
  expect(screen.getByText("29일 [4.1주]",{exact:false})).toBeVisible();
  expect(screen.getByText("학교 시험기간")).toBeVisible();
  expect(screen.getByText("날짜 확인 중")).toBeVisible();
  expect(screen.getByText("수강 여부 확인 필요")).toBeVisible();
  expect(screen.getByText("가상 글쓰기 평가 (25점 만점)")).toBeVisible();
  expect(screen.getAllByRole("link",{name:"학교 공지"})).toHaveLength(2);
});
it("실패에서 0건 안내를 보여주지 않고 실제 재시도를 제공한다", () => {
  render(<SchoolTimeline overview={{status:"error",today:summary.today,groups:[]}} retry={<button>다시 시도</button>} />);
  expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
  expect(screen.getByRole("button",{name:"다시 시도"})).toBeVisible();
  expect(screen.queryByText(/일정이 없습니다/)).toBeNull();
});
it("선택 안 됨과 조회 성공 0건을 구별한다", () => {
  const {rerender}=render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[]}} />);
  expect(screen.getByText("등록된 학생의 학교 일정이 없습니다.")).toBeVisible();
  rerender(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{summary:{...summary,status:"unlinked",events:[]},studentCount:1}]}} />);
  expect(screen.getByText("학생 정보에서 학교를 검색해 선택해 주세요.")).toBeVisible();
});
it("시험 배지가 이름보다 먼저 배치된다", () => {
  const {container}=render(<SchoolExamIdentity summary={summary}><strong>가상 학생</strong></SchoolExamIdentity>);
  expect(container.textContent?.indexOf("2-1")).toBeLessThan(container.textContent!.indexOf("가상 학생"));
  expect(screen.getByTitle(/학교 시험기간 첫날 기준/)).toBeVisible();
});
it("학교 배부물은 출처명으로 표시하며 주차를 임의 날짜로 바꾸지 않는다", () => {
  const events = [
    {...summary.events[1], id:"handout-day", startDate:"2026-09-15", endDate:"2026-09-15", precision:"day" as const, status:"confirmed" as const, sourceUrl:null, sourceLabel:"학교 배부 안내문 · 9월13일 확인"},
    {...summary.events[1], id:"handout-week", precision:"week" as const, status:"planned" as const, dateText:"10월 4주", sourceUrl:null, sourceLabel:"학교 배부 안내문 · 9월13일 확인"},
  ];
  render(<SchoolTimeline overview={{status:"ready",today:summary.today,groups:[{summary:{...summary,events},studentCount:1}]}} />);
  expect(screen.getAllByText("학교 배부 안내문 · 9월13일 확인")).toHaveLength(2);
  expect(screen.getByText("10월 4주 · 예정")).toBeVisible();
  expect(screen.queryAllByRole("link")).toHaveLength(0);
});
