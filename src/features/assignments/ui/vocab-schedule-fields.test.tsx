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
    },
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
    splitScheduleIssue: false,
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
    expect(screen.getByText("선택 요일 3개 · 배정 회차 3회")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "수" }));
    expect(value.actions.toggleWeekday).toHaveBeenCalledWith(3);
  });
});
