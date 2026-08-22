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
      changeOverflowPolicy: vi.fn(),
      changeUnitAllocationMode: vi.fn(),
      changeUnitsPerSession: vi.fn(),
      changeWeekdayUnitsPerSession: vi.fn(),
    },
    fieldErrors: {},
    bulk: { preview: null },
    defaultSessionCount: 3,
    scheduledQuestionCount: 60,
    requiresExtraDateDecision: false,
    planner: {
      distribution: "split",
      splitBasis: "question_count",
      questionCountMode: "all",
      overflowPolicy: "leave",
      unitAllocationMode: "same",
      unitsPerSession: 2,
      weekdayUnitsPerSession: {
        1: 2,
        2: 2,
        3: 2,
        4: 2,
        5: 2,
        6: 2,
        7: 2,
      },
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
    selectedUnits: [
      { id: "unit-1", label: "DAY 1" },
      { id: "unit-2", label: "DAY 2" },
    ],
    templateSaving: false,
    timeTemplates: [],
    unitAllocation: null,
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

  it("요일별 범위 단위 수와 완료 후 이어 배정 횟수를 표시한다", () => {
    const value = controller();
    value.planner.splitBasis = "range_unit";
    value.planner.unitAllocationMode = "by_weekday";
    value.planner.schedule.weekdays = [1, 3];
    value.scheduleSlots = value.scheduleSlots.slice(0, 2);
    value.unitAllocation = {
      defaultSessionCount: 3,
      issue: null,
      remainingUnitIds: [],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0, 0, 0],
      sessionUnitIds: [["unit-1"], ["unit-2"], ["unit-3"]],
    };

    render(<VocabScheduleFields controller={value} />);

    expect(screen.getByLabelText("월요일 단위 수")).toHaveValue(2);
    expect(screen.getByLabelText("수요일 단위 수")).toHaveValue(2);
    expect(screen.getByText("기본 3회 · 이어 배정 2회")).toBeVisible();
    fireEvent.change(screen.getByLabelText("수요일 단위 수"), {
      target: { value: "3" },
    });
    expect(value.actions.changeWeekdayUnitsPerSession).toHaveBeenCalledWith(
      3,
      3,
    );
  });

  it("문항 수로 나눌 때도 남은 문제를 다음 주로 잇는 선택을 제공한다", () => {
    const value = controller();
    value.planner.questionCountMode = "manual";

    render(<VocabScheduleFields controller={value} />);

    expect(screen.getByText("남은 문제")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "같은 요일로 이어서" }));
    expect(value.actions.changeOverflowPolicy).toHaveBeenCalledWith(
      "continue_weekly",
    );
  });

  it("이번 일정만 배정하면 남은 정확한 범위를 표시한다", () => {
    const value = controller();
    value.planner.splitBasis = "range_unit";
    value.unitAllocation = {
      defaultSessionCount: 2,
      issue: null,
      remainingUnitIds: ["unit-2"],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0],
      sessionUnitIds: [["unit-1"]],
    };

    render(<VocabScheduleFields controller={value} />);

    expect(screen.getByText("기본 2회 · 남음 DAY 2 (1단위)")).toBeVisible();
  });

  it("선택 일정의 대기 회차와 일정 밖 남은 범위를 함께 표시한다", () => {
    const value = controller();
    value.planner.splitBasis = "range_unit";
    value.planner.schedule.weekdays = [1, 3];
    value.selectedUnits = [
      { id: "unit-1", label: "DAY 1" },
      { id: "unit-2", label: "DAY 2" },
      { id: "unit-3", label: "DAY 3" },
      { id: "unit-4", label: "DAY 4" },
      { id: "unit-5", label: "DAY 5" },
      { id: "unit-6", label: "DAY 6" },
    ] as never;
    value.unitAllocation = {
      defaultSessionCount: 3,
      issue: null,
      remainingUnitIds: ["unit-5", "unit-6"],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0, 0],
      sessionUnitIds: [
        ["unit-1", "unit-2"],
        ["unit-3", "unit-4"],
      ],
    };

    render(<VocabScheduleFields controller={value} />);

    expect(
      screen.getByText("기본 3회 · 이어 배정 1회 · 남음 DAY 5–DAY 6 (2단위)"),
    ).toBeVisible();
  });

  it("나누기 두 번째 회차부터 완료 후 생성 상태를 표시한다", () => {
    const value = controller();
    render(<VocabScheduleFields controller={value} />);

    expect(screen.getAllByText("완료 후 생성")).toHaveLength(2);
  });
});
