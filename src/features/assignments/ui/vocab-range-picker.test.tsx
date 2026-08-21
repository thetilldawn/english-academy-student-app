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
          defaultSessionCount: sessionCount,
          exceptionStudentIds: [],
          normalStudentIds: ["student-a"],
          remainingQuestionCount: input?.remaining ?? 0,
          requiresExtraDateDecision: false,
          representativeStudentId: "student-a",
          selectedQuestionCount: input?.remaining ? 40 : 86,
          scheduledQuestionCount: input?.remaining ? 40 : 86,
          sessions: Array.from({ length: sessionCount }, (_, index) => ({
            availableFrom: `2026-08-${24 + index}T07:00:00.000Z`,
            availableUntil: null,
            questionCount: 20,
            cycleIndex: 0,
            sessionNumber: index + 1,
            unitLabel: "DAY 1~DAY 2",
          })),
        },
      },
    },
    fieldErrors: {},
    defaultSessionCount: sessionCount,
    scheduledQuestionCount: input?.remaining ? 40 : 86,
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
    expect(screen.getByText("출제 가능 86문항 · 출제 86문항 · 남음 0문항 · 기본 3회"))
      .toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    expect(value.actions.changeQuestionCountMode).toHaveBeenCalledWith(
      "manual",
    );
  });

  it("문제 순서와 직접 입력을 시험 조건으로 분리해 제공한다", () => {
    const withRemaining = controller({ manual: true, remaining: 46 });
    render(
      <VocabRangePicker controller={withRemaining} datasets={[dataset]} />,
    );
    expect(screen.getByRole("group", { name: "문제 순서" })).toBeVisible();
    expect(screen.getByText("출제 가능 86문항 · 출제 40문항 · 남음 46문항 · 기본 3회"))
      .toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "무작위" }));
    expect(withRemaining.actions.changeSelectionMode).toHaveBeenCalledWith(
      "random",
    );
  });

  it("공통 요약이 없어도 학생 예외 수치와 전체 모드 오류를 표시한다", () => {
    const value = controller();
    value.bulk.preview!.commonPlanSummary = null;
    value.bulk.preview!.items = [{
      available: true,
      availableQuestionCount: 640,
      error: null,
      remainingQuestionCount: 140,
      selectedQuestionCount: 500,
      defaultSessionCount: 5,
      scheduledQuestionCount: 500,
      requiresExtraDateDecision: false,
      sessions: Array.from({ length: 5 }, () => ({})),
    }] as never;
    value.fieldErrors.questionCount = "한 회차에는 최대 500문항까지 가능합니다.";
    value.defaultSessionCount = 5;
    value.scheduledQuestionCount = 500;
    render(
      <VocabRangePicker
        controller={value}
        datasets={[dataset]}
        fieldErrors={value.fieldErrors}
      />,
    );

    expect(screen.getByText("출제 가능 640문항 · 출제 500문항 · 남음 140문항 · 기본 5회"))
      .toBeVisible();
    expect(screen.queryByText(/공통 1명/)).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "문항 수" });
    expect(group).not.toHaveAttribute("data-invalid");
    expect(group).toHaveAttribute(
      "aria-describedby",
      "vocab-question-count-error",
    );
  });

  it("여러 학생의 공통 요약이 없으면 첫 학생 수치를 공통값처럼 표시하지 않는다", () => {
    const value = controller();
    value.bulk.preview!.commonPlanSummary = null;
    value.bulk.preview!.items = [
      {
        available: true,
        availableQuestionCount: 640,
        defaultSessionCount: 5,
        error: null,
        remainingQuestionCount: 140,
        selectedQuestionCount: 500,
      },
      {
        available: true,
        availableQuestionCount: 86,
        defaultSessionCount: 3,
        error: null,
        remainingQuestionCount: 0,
        selectedQuestionCount: 86,
      },
    ] as never;

    render(<VocabRangePicker controller={value} datasets={[dataset]} />);

    expect(
      screen.getByText("학생별 계획을 마지막 미리보기에서 확인해 주세요."),
    ).toBeVisible();
    expect(screen.queryByText(/별도 확인 2명/)).not.toBeInTheDocument();
    expect(screen.queryByText(/출제 가능 640문항/)).not.toBeInTheDocument();
  });
});
