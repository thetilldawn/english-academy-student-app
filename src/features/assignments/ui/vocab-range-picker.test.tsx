// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createRef } from "react";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { VocabAssignmentPlannerController } from "../controller/use-vocab-assignment-planner";
import { VocabRangePicker } from "./vocab-range-picker";
import { VocabRangeFields, type VocabRangeFieldsProps } from "./vocab-range-fields";

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
  assignmentMode?: "all_sessions" | "per_session" | "word_count";
  manual?: boolean;
  overflowPolicy?: "leave" | "continue_weekly";
  remaining?: number;
  sessionCount?: number;
}) {
  const actions = {
    activateManualQuestionCount: vi.fn(),
    changeAssignmentMode: vi.fn(),
    changeDataset: vi.fn(),
    changeManualQuestionCount: vi.fn(),
    changeOverflowPolicy: vi.fn(),
    changeQuestionCountMode: vi.fn(),
    changeSelectionMode: vi.fn(),
    selectAllUnits: vi.fn(),
    selectUnit: vi.fn(),
  };
  const sessionCount = input?.sessionCount ?? 3;
  const assignmentMode = input?.assignmentMode ?? "all_sessions";
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
    distribution: assignmentMode === "all_sessions" ? "repeat" : "split",
    scheduledQuestionCount: input?.remaining ? 40 : 86,
    planner: {
      assignmentMode,
      datasetId: dataset.id,
      manualQuestionCount: input?.manual ? 20 : 0,
      overflowPolicy: input?.overflowPolicy ?? "leave",
      questionCountMode: input?.manual ? "manual" : "all",
      range: { selectedUnitIds: units.map((unit) => unit.id) },
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

function rangeFields(overrides: Partial<VocabRangeFieldsProps> = {}): VocabRangeFieldsProps {
  return { dataset, units, selectedUnitIds: [], onSelectUnit: vi.fn(),
    onToggleAllUnits: vi.fn(), onOpenDatasetPicker: vi.fn(), ...overrides };
}

describe("독립된 범위 표시 부품", () => {
  it("선택 범위 개수와 수록 단어 합계를 미리보기 없이 표시한다", () => {
    render(<VocabRangeFields {...rangeFields({ selectedUnitIds: units.map(unit => unit.id) })} />);
    expect(screen.getByText("선택한 범위 2개 · 수록 단어 86개")).toBeInTheDocument();
    expect(screen.getAllByText("수록 43개")).toHaveLength(2);
  });
  it("수량 미확정 시 초점만으로 직접 입력 0개를 저장하지 않는다", () => {
    const value = controller({ assignmentMode: "word_count" });
    value.bulk.preview = null;
    value.bulk.previewLoading = true;
    render(<VocabRangePicker controller={value} datasets={[dataset]} onOpenDatasetPicker={vi.fn()} />);
    const input = screen.getByRole("spinbutton", { name: "회차당 단어 수" });
    fireEvent.focus(input);
    expect(value.actions.activateManualQuestionCount).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("placeholder", "직접 입력");
    expect(screen.getByText("출제 가능 단어 수를 확인하는 중입니다.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "20" } });
    expect(value.actions.changeManualQuestionCount).toHaveBeenCalledWith(20);
  });
  it("전체 제어기 없이 필요한 입력과 선택 동작만 사용한다", () => {
    expectTypeOf<keyof VocabRangeFieldsProps>().toEqualTypeOf<
      "dataset" | "units" | "selectedUnitIds" | "datasetError" | "rangeError" |
      "onSelectUnit" | "onToggleAllUnits" | "onOpenDatasetPicker" | "datasetTriggerRef"
    >();
    const props = rangeFields();
    render(<VocabRangeFields {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "DAY 2" }));
    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    fireEvent.click(screen.getByRole("button", { name: /테스트 단어장.*단어장 찾기/ }));
    expect(props.onSelectUnit).toHaveBeenCalledWith("unit-2");
    expect(props.onToggleAllUnits).toHaveBeenCalledWith(true);
    expect(props.onOpenDatasetPicker).toHaveBeenCalledOnce();
  });
  it("역순 선택을 표시하고 원본 순서를 바꾸지 않는다", () => {
    const ids = Object.freeze(["unit-2", "unit-1"]);
    const props = rangeFields({ units: Object.freeze([...units]), selectedUnitIds: ids });
    render(<VocabRangeFields {...props} />);
    expect(screen.getByText("DAY 2~DAY 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "전체 해제" }));
    expect(props.onToggleAllUnits).toHaveBeenCalledWith(false);
    expect(ids).toEqual(["unit-2", "unit-1"]);
    expect(props.units.map(unit => unit.id)).toEqual(["unit-1", "unit-2"]);
  });
  it("쉬운 오류 안내를 해당 입력과 연결하고 찾기 버튼 참조를 유지한다", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<VocabRangeFields {...rangeFields({ datasetTriggerRef: ref,
      datasetError: "단어장을 선택해 주세요.", rangeError: "시험 범위를 선택해 주세요." })} />);
    expect(ref.current).toBe(screen.getByRole("button", { name: /테스트 단어장.*단어장 찾기/ }));
    expect(ref.current).toHaveAttribute("aria-describedby", "vocab-dataset-error");
    expect(ref.current).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "시험 범위 선택" })).toHaveAttribute("aria-describedby", "vocab-range-error");
    expect(screen.getByText("단어장을 선택해 주세요.")).toHaveAttribute("id", "vocab-dataset-error");
    expect(screen.getByText("시험 범위를 선택해 주세요.")).toHaveAttribute("id", "vocab-range-error");
  });
  it("단어장 미선택과 빈 범위를 오류로 꾸미지 않는다", () => {
    render(<VocabRangeFields {...rangeFields({ dataset: undefined, units: [] })} />);
    expect(screen.getByRole("button", { name: /단어장을 선택해 주세요.*단어장 찾기/ })).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "전체 선택" })).toBeDisabled();
    expect(screen.getByText("시험 범위를 선택해 주세요.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("VocabRangePicker", () => {
  it("실제 연결부에서 직접 입력 활성화 후 값 변경을 실행한다", () => {
    const value = controller({ assignmentMode: "word_count" });
    render(<VocabRangePicker onOpenDatasetPicker={vi.fn()} controller={value} datasets={[dataset]} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "회차당 단어 수" }), { target: { value: "20" } });
    expect(value.actions.activateManualQuestionCount).toHaveBeenCalledWith(86);
    expect(value.actions.changeManualQuestionCount).toHaveBeenCalledWith(20);
    expect(vi.mocked(value.actions.activateManualQuestionCount).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(value.actions.changeManualQuestionCount).mock.invocationCallOrder[0]);
  });
  it("역방향 선택을 요약에도 같은 방향으로 표시한다", () => {
    const value = controller();
    value.selectedUnits = [units[1]!, units[0]!];

    render(<VocabRangePicker onOpenDatasetPicker={vi.fn()} controller={value} datasets={[dataset]} />);

    expect(screen.getByText("DAY 2~DAY 1")).toBeVisible();
  });

  it("배정 방식을 전체 회차·회차별·단어 수로 제공한다", () => {
    const value = controller();
    render(<VocabRangePicker onOpenDatasetPicker={vi.fn()} controller={value} datasets={[dataset]} />);

    expect(screen.getByRole("button", { name: "전체 회차" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "회차별" }));
    expect(value.actions.changeAssignmentMode).toHaveBeenCalledWith(
      "per_session",
    );
    fireEvent.click(screen.getByRole("button", { name: "단어 수" }));
    expect(value.actions.changeAssignmentMode).toHaveBeenCalledWith(
      "word_count",
    );
  });

  it("단어 수에서 전체와 숫자 입력을 함께 두고 전체 개수를 기본값으로 쓴다", () => {
    const value = controller({ assignmentMode: "word_count" });
    render(<VocabRangePicker onOpenDatasetPicker={vi.fn()} controller={value} datasets={[dataset]} />);

    const input = screen.getByRole("spinbutton", { name: "회차당 단어 수" });
    expect(input).toHaveValue(86);
    fireEvent.focus(input);
    expect(value.actions.activateManualQuestionCount).toHaveBeenCalledWith(86);
    fireEvent.click(screen.getByRole("button", { name: "전체 사용 · 86개" }));
    expect(value.actions.changeQuestionCountMode).toHaveBeenCalledWith(
      "all",
    );
  });

  it("출제 단어 선택과 직접 입력을 시험 조건으로 분리해 제공한다", () => {
    const withRemaining = controller({
      assignmentMode: "word_count",
      manual: true,
      remaining: 46,
    });
    render(
      <VocabRangePicker onOpenDatasetPicker={vi.fn()} controller={withRemaining} datasets={[dataset]} />,
    );
    expect(screen.getByRole("group", { name: "출제 단어 선택" }))
      .toBeVisible();
    expect(screen.getByText("출제 가능 86개 · 배정 40개 · 남음 46개 · 기본 3회"))
      .toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "무작위" }));
    expect(withRemaining.actions.changeSelectionMode).toHaveBeenCalledWith(
      "random",
    );
    fireEvent.click(screen.getByRole("button", { name: "회차별" }));
    expect(withRemaining.actions.changeAssignmentMode).toHaveBeenCalledWith(
      "per_session",
    );
  });

  it("공통 요약이 없어도 학생 예외 수치와 전체 모드 오류를 표시한다", () => {
    const value = controller({ assignmentMode: "word_count" });
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
      <VocabRangePicker onOpenDatasetPicker={vi.fn()}
        controller={value}
        datasets={[dataset]}
        fieldErrors={value.fieldErrors}
      />,
    );

    expect(screen.getByText("출제 가능 640개 · 배정 500개 · 남음 140개 · 기본 5회"))
      .toBeVisible();
    expect(screen.queryByText(/공통 1명/)).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "단어 수" });
    expect(group).not.toHaveAttribute("data-invalid");
    expect(group).toHaveAttribute(
      "aria-describedby",
      "vocab-question-count-error",
    );
  });

  it("여러 학생의 공통 요약이 없으면 첫 학생 수치를 공통값처럼 표시하지 않는다", () => {
    const value = controller({ assignmentMode: "word_count" });
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

    render(<VocabRangePicker onOpenDatasetPicker={vi.fn()} controller={value} datasets={[dataset]} />);

    expect(
      screen.getByText("학생별 출제 가능 수는 마지막 미리보기에서 확인해 주세요."),
    ).toBeVisible();
    expect(screen.queryByText(/별도 확인 2명/)).not.toBeInTheDocument();
    expect(screen.queryByText(/출제 가능 640개/)).not.toBeInTheDocument();
  });
});
