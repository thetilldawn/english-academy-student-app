// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import { VocabRangePicker } from "./vocab-range-picker";

const dataset: AssignmentDatasetItem = {
  academicYear: null,
  catalogGroup: "high",
  catalogSortIndex: 1,
  curriculumRevision: null,
  displayName: "테스트 단어장",
  edition: null,
  editionLabel: null,
  gradeCode: "H1",
  id: "dataset-a",
  isActive: true,
  isAssignable: true,
  materialKind: "wordbook",
  publisher: null,
  rowCount: 86,
  seriesTitle: null,
  status: "ready",
  title: "테스트 단어장",
};

const units: AssignmentUnitItem[] = [1, 2].map((number) => ({
  academicYear: null,
  agency: null,
  catalogGroup: "high",
  catalogSortIndex: number,
  datasetId: dataset.id,
  displayName: `DAY ${number}`,
  entryCount: 43,
  examMonth: null,
  id: `unit-${number}`,
  itemRange: null,
  kind: "day",
  label: `DAY ${number}`,
  number,
  sortIndex: number,
  unitType: "day",
}));

function controller(input?: {
  manual?: boolean;
  overflowPolicy?: "leave" | "continue_weekly";
  remaining?: number;
  sessionCount?: number;
}) {
  const actions = {
    changeDataset: vi.fn(),
    changeDistribution: vi.fn(),
    changeManualQuestionCount: vi.fn(),
    changeOverflowPolicy: vi.fn(),
    changeQuestionCountMode: vi.fn(),
    changeSelectionMode: vi.fn(),
    selectUnit: vi.fn(),
  };
  const sessionCount = input?.sessionCount ?? 3;
  return {
    actions,
    availableUnits: units,
    bulk: {
      preview: {
        commonPlanSummary: {
          availableQuestionCount: 86,
          exceptionStudentIds: [],
          normalStudentIds: ["student-a"],
          remainingQuestionCount: input?.remaining ?? 0,
          representativeStudentId: "student-a",
          selectedQuestionCount: input?.remaining ? 40 : 86,
          sessions: Array.from({ length: sessionCount }, (_, index) => ({
            availableFrom: `2026-08-${24 + index}T07:00:00.000Z`,
            availableUntil: null,
            questionCount: 20,
            sessionNumber: index + 1,
            unitLabel: "DAY 1~DAY 2",
          })),
        },
      },
    },
    fieldErrors: {},
    planner: {
      datasetId: dataset.id,
      distribution: "split",
      manualQuestionCount: 20,
      overflowPolicy: input?.overflowPolicy ?? "leave",
      questionCountMode: input?.manual ? "manual" : "all",
      range: { startUnitId: units[0]!.id, endUnitId: units[1]!.id },
      selectionMode: "source_order",
    },
    scheduleSlots: Array.from({ length: 3 }, (_, index) => ({
      availableLocalDateTime: `2026-08-${24 + index}T16:00`,
      date: `2026-08-${24 + index}`,
      deadlineLocalDateTime: `2026-08-${24 + index}T22:00`,
      sessionNumber: index + 1,
    })),
    selectedUnits: units,
  } as unknown as VocabAssignmentPlannerController;
}

afterEach(cleanup);

describe("VocabRangePicker", () => {
  it("전체 문항을 기본값으로 두고 실제 가능·출제·남은 수를 표시한다", () => {
    const value = controller();
    render(<VocabRangePicker controller={value} datasets={[dataset]} />);

    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("출제 가능 86 · 이번 배정 86 · 남음 0"))
      .toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    expect(value.actions.changeQuestionCountMode).toHaveBeenCalledWith(
      "manual",
    );
  });

  it("남은 문항이 있거나 다음 주 일정이 만들어진 동안 처리 선택을 유지한다", () => {
    const withRemaining = controller({ manual: true, remaining: 46 });
    const { rerender } = render(
      <VocabRangePicker controller={withRemaining} datasets={[dataset]} />,
    );
    expect(screen.getByRole("button", { name: "이번 일정만" })).toBeVisible();
    expect(screen.getByText("출제 가능 86 · 이번 배정 40 · 남음 46"))
      .toBeVisible();

    const continued = controller({
      manual: true,
      overflowPolicy: "continue_weekly",
      remaining: 0,
      sessionCount: 5,
    });
    rerender(<VocabRangePicker controller={continued} datasets={[dataset]} />);
    expect(screen.getByRole("button", { name: "같은 요일로 이어서" }))
      .toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "이번 일정만" }));
    expect(continued.actions.changeOverflowPolicy).toHaveBeenCalledWith(
      "leave",
    );
  });

  it("공통 요약이 없어도 학생 예외 수치와 전체 모드 오류를 표시한다", () => {
    const value = controller();
    value.bulk.preview!.commonPlanSummary = null;
    value.bulk.preview!.items = [{
      availableQuestionCount: 640,
      remainingQuestionCount: 140,
      selectedQuestionCount: 500,
      sessions: Array.from({ length: 5 }, () => ({})),
    }] as never;
    value.fieldErrors.questionCount = "한 회차에는 최대 500문항까지 가능합니다.";
    render(<VocabRangePicker controller={value} datasets={[dataset]} />);

    expect(screen.getByText("출제 가능 640 · 이번 배정 500 · 남음 140"))
      .toBeVisible();
    const group = screen.getByRole("group", { name: "문항 수" });
    expect(group).toHaveAttribute("data-invalid", "true");
    expect(group).toHaveAttribute(
      "aria-describedby",
      "vocab-question-count-error",
    );
  });
});
