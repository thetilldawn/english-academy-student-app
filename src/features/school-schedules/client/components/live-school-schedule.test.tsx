// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../actions/edit-school-schedule", () => ({ refreshSchoolScheduleOverviewAction: vi.fn() }));
import { LiveSchoolExamIdentity, LiveSchoolTimeline, useSchoolDisplayDate } from "./live-school-schedule";
import { buildSchoolSummary } from "../../domain/school-schedule";
import { fakeSchoolBundle as bundle } from "../../school-schedule.fixture";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each([['2026-07-31','2026-08-01'],['2027-02-28','2027-03-01']])("학기 경계 %s에는 이전 과제를 숨기고 수동 갱신을 요청한다", (before,after) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(`${before}T12:00:00+09:00`));
  const summary=buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:'고2'},[bundle],before);
  render(<><LiveSchoolExamIdentity summary={summary}>이름</LiveSchoolExamIdentity><LiveSchoolTimeline overview={{status:'ready',today:before,groups:[{summary,studentCount:1}]}} retry={<button>다시 시도</button>} /></>);
  vi.setSystemTime(new Date(`${after}T01:00:00+09:00`));
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByText('일정 갱신 필요')).toBeTruthy();
  expect(screen.getByText('새 학기 일정을 다시 확인해 주세요.')).toBeTruthy();
  expect(screen.queryByText('가상 글쓰기 평가 (25점 만점)')).toBeNull();
  expect(screen.getByRole('button',{name:'다시 시도'})).toBeTruthy();
});
it("한국 자정과 탭 복귀에 날짜만 바꾸고 정리 후 타이머를 남기지 않는다", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T14:59:59Z"));
  const {result,unmount}=renderHook(()=>useSchoolDisplayDate("2026-09-13"));
  act(()=>vi.advanceTimersByTime(0)); expect(result.current).toBe("2026-09-13");
  act(()=>vi.advanceTimersByTime(1200)); expect(result.current).toBe("2026-09-14");
  vi.setSystemTime(new Date("2026-09-16T08:00:00Z"));
  act(()=>document.dispatchEvent(new Event("visibilitychange"))); expect(result.current).toBe("2026-09-16");
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
