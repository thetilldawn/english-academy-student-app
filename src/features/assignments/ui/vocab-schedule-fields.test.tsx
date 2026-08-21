/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocabAssignmentScreenController } from "../controller/use-vocab-assignment-screen";
import { VocabScheduleFields } from "./vocab-schedule-fields";

afterEach(cleanup);

function controller() {
  return {
    actions: {
      applyTemplate: vi.fn(),
      saveCurrentTemplate: vi.fn(),
      toggleWeekday: vi.fn(),
      updateSchedule: vi.fn(),
      updateSessionSchedule: vi.fn(),
      cancelExtraDates: vi.fn(),
      changeExtraDatePolicy: vi.fn(),
    },
    fieldErrors: {},
    bulk: { preview: null },
    defaultSessionCount: 3,
    scheduledQuestionCount: 60,
    requiresExtraDateDecision: false,
    planner: {
      schedule: {
        availableTime: "16:00",
        deadlineDayOffset: 0,
        deadlineTime: "22:00",
        startDate: "2026-08-21",
        weekdays: [1, 3, 5],
      },
    },
    scheduleSlots: [
      {
        availableLocalDateTime: "2026-08-24T16:00",
        date: "2026-08-24",
        deadlineLocalDateTime: "2026-08-24T22:00",
        sessionNumber: 1,
      },
      {
        availableLocalDateTime: "2026-08-26T16:00",
        date: "2026-08-26",
        deadlineLocalDateTime: "2026-08-26T22:00",
        sessionNumber: 2,
      },
      {
        availableLocalDateTime: "2026-08-28T16:00",
        date: "2026-08-28",
        deadlineLocalDateTime: "2026-08-28T22:00",
        sessionNumber: 3,
      },
    ],
    selectedUnits: [{ label: "DAY 1" }, { label: "DAY 2" }],
    templateSaving: false,
    timeTemplates: [],
  } as unknown as VocabAssignmentScreenController;
}

describe("VocabScheduleFields", () => {
  it("월수금 선택 상태와 세 회차의 실제 날짜를 함께 표시한다", () => {
    const value = controller();
    render(<VocabScheduleFields controller={value} />);

    expect(screen.getByText("배정 기준일")).toBeVisible();
    expect(screen.getByRole("button", { name: "월" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "화" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "수" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "금" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/1회차 · 8월 24일 \(월\)/)).toBeVisible();
    expect(screen.getByText(/2회차 · 8월 26일 \(수\)/)).toBeVisible();
    expect(screen.getByText(/3회차 · 8월 28일 \(금\)/)).toBeVisible();
    expect(screen.getByText("선택 요일 3개 · 배정 3회")).toBeVisible();

    fireEvent.change(screen.getByDisplayValue("2026-08-21"), {
      target: { value: "2026-08-22" },
    });
    expect(value.actions.updateSchedule).toHaveBeenCalledWith({
      startDate: "2026-08-22",
    });

    fireEvent.click(screen.getByRole("button", { name: "수" }));
    expect(value.actions.toggleWeekday).toHaveBeenCalledWith(3);
  });

  it("공통 요약이 없는 예외 학생도 연장된 최종 회차 수를 표시한다", () => {
    const value = controller();
    value.bulk.preview = {
      commonPlanSummary: null,
      items: [{ sessions: Array.from({ length: 5 }, () => ({})) }],
    } as never;
    render(<VocabScheduleFields controller={value} />);

    expect(
      screen.getByText("선택 요일 3개 · 배정 5회"),
    ).toBeVisible();
  });

  it("기본 회차보다 날짜가 많으면 범위 반복 여부를 확인한다", () => {
    const value = controller();
    value.defaultSessionCount = 3;
    value.extraDateDecisionSessionCount = 2;
    value.requiresExtraDateDecision = true;
    render(<VocabScheduleFields controller={value} />);

    expect(screen.getByText("기본 최소 2회")).toBeVisible();
    expect(screen.getByText(/기본 2회보다 날짜가 많습니다/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "범위 반복" }));
    expect(value.actions.changeExtraDatePolicy).toHaveBeenCalledWith(
      "repeat_from_start",
    );
    fireEvent.click(screen.getByRole("button", { name: "추가 취소" }));
    expect(value.actions.cancelExtraDates).toHaveBeenCalledOnce();
  });

  it("요일을 고르기 전에는 계산용 임시 날짜를 일정처럼 표시하지 않는다", () => {
    const value = controller();
    value.planner.schedule.weekdays = [];
    value.scheduleSlots = [];
    value.bulk.preview = {
      commonPlanSummary: {
        sessions: [
          {
            sessionNumber: 1,
            availableFrom: "2026-08-21T07:00:00.000Z",
            availableUntil: "2026-08-21T13:00:00.000Z",
            questionCount: 45,
          },
          {
            sessionNumber: 2,
            availableFrom: "2026-08-28T07:00:00.000Z",
            availableUntil: "2026-08-28T13:00:00.000Z",
            questionCount: 35,
          },
        ],
      },
      items: [],
    } as never;

    render(<VocabScheduleFields controller={value} />);

    expect(screen.queryByText("회차별 시간")).not.toBeInTheDocument();
    expect(screen.queryByText(/배정 합계/)).not.toBeInTheDocument();
    expect(screen.getByText("선택 요일 0개 · 배정 0회")).toBeVisible();
  });

  it("미리보기가 없어도 현재 선택한 단어장을 일정 태그에 표시한다", () => {
    const value = controller();
    value.planner.datasetId = "dataset-a";
    value.readyDatasets = [{
      id: "dataset-a",
      title: "선택 단어장",
      displayName: "선택 단어장",
      edition: null,
      editionLabel: null,
      catalogGroup: "high",
      materialKind: "wordbook",
      gradeCode: "H1",
      publisher: null,
      seriesTitle: null,
      academicYear: null,
      curriculumRevision: null,
      isAssignable: true,
      catalogSortIndex: 1,
    }] as never;

    render(<VocabScheduleFields controller={value} />);

    expect(screen.getByText("선택 단어장")).toBeVisible();
  });
});
