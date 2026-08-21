// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import { useVocabAssignmentPlanner } from "./use-vocab-assignment-planner";

const mocks = vi.hoisted(() => ({
  changeCommonPlan: vi.fn(),
}));

vi.mock("./use-bulk-assignment-controller", () => ({
  useBulkAssignmentController: () => ({
    actions: {
      changeCommonPlan: mocks.changeCommonPlan,
      changeDirection: vi.fn(),
      changeOrder: vi.fn(),
      changePassingScore: vi.fn(),
      changeTiming: vi.fn(),
      submit: vi.fn(),
    },
    canSubmit: false,
    preview: null,
    previewLoading: false,
    state: {
      draft: {
        exam: {
          directionRatio: 50,
          passingScore: 80,
          questionOrderMode: "random",
          timing: { mode: "total", totalSeconds: 300 },
        },
      },
      submission: { status: "idle" },
    },
  }),
}));

vi.mock("./use-vocab-time-templates", () => ({
  useVocabTimeTemplates: () => ({
    customTemplates: [],
    saveCurrentTemplate: vi.fn(),
    saving: false,
    timeTemplates: [],
  }),
}));

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
  rowCount: 120,
  seriesTitle: null,
  status: "ready",
  title: "테스트 단어장",
};

const units: AssignmentUnitItem[] = Array.from({ length: 6 }, (_, index) => ({
  academicYear: null,
  agency: null,
  catalogGroup: "high",
  catalogSortIndex: index + 1,
  datasetId: dataset.id,
  displayName: `DAY ${index + 1}`,
  entryCount: 20,
  examMonth: null,
  id: `unit-${index + 1}`,
  itemRange: null,
  kind: "day",
  label: `DAY ${index + 1}`,
  number: index + 1,
  sortIndex: index + 1,
  unitType: "day",
}));

function renderPlanner() {
  return renderHook(() => useVocabAssignmentPlanner({
    datasets: [dataset],
    genericErrorMessage: "저장 실패",
    initialDatasetId: dataset.id,
    previousExamHistory: [],
    previousExamSourceStudentId: "",
    previewErrorMessage: "미리보기 실패",
    studentIds: ["student-a"],
    today: "2026-08-21",
    units,
  }));
}

function selectWholeRange(
  result: ReturnType<typeof renderPlanner>["result"],
) {
  act(() => {
    result.current.actions.selectUnit(units[0]!.id);
    result.current.actions.selectUnit(units.at(-1)!.id);
  });
}

describe("단어 배정 일정 controller", () => {
  beforeEach(() => {
    mocks.changeCommonPlan.mockReset();
  });

  it("월수금은 날짜 범위와 무관하게 세 회차만 만들고 실제 날짜를 보존한다", () => {
    const { result } = renderHook(() => useVocabAssignmentPlanner({
      datasets: [],
      genericErrorMessage: "저장 실패",
      initialDatasetId: "",
      previousExamHistory: [],
      previousExamSourceStudentId: "",
      previewErrorMessage: "미리보기 실패",
      studentIds: [],
      today: "2026-08-21",
      units: [],
    }));

    expect(result.current.planner.schedule.startDate).toBe("2026-08-21");
    expect(result.current.scheduleSlots.map((slot) => slot.date)).toEqual([
      "2026-08-24",
      "2026-08-26",
      "2026-08-28",
    ]);
  });

  it("같은 렌더에서 요일을 빠르게 연속 변경해도 앞 변경을 잃지 않는다", () => {
    const { result } = renderHook(() => useVocabAssignmentPlanner({
      datasets: [],
      genericErrorMessage: "저장 실패",
      initialDatasetId: "",
      previousExamHistory: [],
      previousExamSourceStudentId: "",
      previewErrorMessage: "미리보기 실패",
      studentIds: [],
      today: "2026-08-21",
      units: [],
    }));

    act(() => {
      result.current.actions.toggleWeekday(2);
      result.current.actions.toggleWeekday(4);
    });
    expect(result.current.planner.schedule.weekdays).toEqual([1, 2, 3, 4, 5]);

    act(() => {
      result.current.actions.toggleWeekday(3);
      result.current.actions.toggleWeekday(3);
    });
    expect(result.current.planner.schedule.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("전체 반복은 같은 DAY 범위를 월수금 세 날짜에 정확히 한 번씩 배정한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    act(() => result.current.actions.changeDistribution("repeat"));

    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: session.availableLocalDateTime.slice(0, 10),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-24", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-26", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-28", unitIds: units.map((unit) => unit.id) },
    ]);
  });

  it("나누기는 DAY 범위를 월수금 세 회차의 서로 다른 묶음으로 나눈다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);

    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: session.availableLocalDateTime.slice(0, 10),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-24", unitIds: ["unit-1", "unit-2"] },
      { date: "2026-08-26", unitIds: ["unit-3", "unit-4"] },
      { date: "2026-08-28", unitIds: ["unit-5", "unit-6"] },
    ]);
  });

  it("DAY가 회차보다 적은 나누기는 공통 계획을 지우고 배정을 막는다", () => {
    const { result } = renderPlanner();
    act(() => {
      result.current.actions.selectUnit(units[0]!.id);
      result.current.actions.selectUnit(units[1]!.id);
    });

    expect(result.current.scheduleSlots).toHaveLength(3);
    expect(result.current.rangeSessions).toEqual([]);
    expect(result.current.splitScheduleIssue).toBe(true);
    expect(result.current.commonPlan).toBeUndefined();
    expect(mocks.changeCommonPlan).toHaveBeenLastCalledWith(undefined);
  });

  it("요일을 3개에서 2개로 줄였다 다시 늘리면 공통 계획도 3→2→3회로 동기화한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    expect(result.current.commonPlan?.sessions).toHaveLength(3);

    act(() => result.current.actions.toggleWeekday(3));
    expect(result.current.commonPlan?.sessions).toHaveLength(2);
    expect(result.current.commonPlan?.sessions.map((session) =>
      session.availableLocalDateTime.slice(0, 10))).toEqual([
      "2026-08-24",
      "2026-08-28",
    ]);

    act(() => result.current.actions.toggleWeekday(3));
    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(mocks.changeCommonPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessions: expect.arrayContaining([
        expect.objectContaining({
          availableLocalDateTime: "2026-08-24T16:00",
        }),
        expect.objectContaining({
          availableLocalDateTime: "2026-08-26T16:00",
        }),
        expect.objectContaining({
          availableLocalDateTime: "2026-08-28T16:00",
        }),
      ]) }),
    );
  });
});
