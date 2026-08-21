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
  preview: null as null | {
    commonPlanSummary: null;
    items: Array<{
      defaultSessionCount: number;
      error: null;
      errorFieldKey?: "weekdays";
      requiresExtraDateDecision: boolean;
      scheduledQuestionCount: number;
    }>;
  },
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
    preview: mocks.preview,
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

function selectMondayWednesdayFriday(
  result: ReturnType<typeof renderPlanner>["result"],
) {
  act(() => {
    result.current.actions.toggleWeekday(1);
    result.current.actions.toggleWeekday(3);
    result.current.actions.toggleWeekday(5);
  });
}

describe("단어 배정 일정 controller", () => {
  beforeEach(() => {
    mocks.changeCommonPlan.mockReset();
    mocks.preview = null;
  });

  it("요일은 처음에 비어 있고 월수금을 고르면 가까운 세 날짜를 만든다", () => {
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
    expect(result.current.scheduleSlots).toEqual([]);
    act(() => {
      result.current.actions.toggleWeekday(1);
      result.current.actions.toggleWeekday(3);
      result.current.actions.toggleWeekday(5);
    });
    expect(result.current.scheduleSlots.map((slot) => slot.date)).toEqual([
      "2026-08-21",
      "2026-08-24",
      "2026-08-26",
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
    expect(result.current.planner.schedule.weekdays).toEqual([2, 4]);

    act(() => {
      result.current.actions.toggleWeekday(3);
      result.current.actions.toggleWeekday(3);
    });
    expect(result.current.planner.schedule.weekdays).toEqual([2, 4]);
  });

  it("전체 반복은 같은 DAY 범위를 월수금 세 날짜에 정확히 한 번씩 배정한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);
    act(() => result.current.actions.changeDistribution("repeat"));

    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: session.availableLocalDateTime.slice(0, 10),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-21", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-24", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-26", unitIds: units.map((unit) => unit.id) },
    ]);
  });

  it("나누기는 모든 회차에 같은 전체 DAY 범위를 보내고 서버가 실제 문항을 나눈다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);

    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: session.availableLocalDateTime.slice(0, 10),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-21", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-24", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-26", unitIds: units.map((unit) => unit.id) },
    ]);
  });

  it("DAY 수가 날짜보다 적어도 실제 출제 가능 문항은 서버에서 검증한다", () => {
    const { result } = renderPlanner();
    act(() => {
      result.current.actions.selectUnit(units[0]!.id);
      result.current.actions.selectUnit(units[1]!.id);
    });
    selectMondayWednesdayFriday(result);

    expect(result.current.scheduleSlots).toHaveLength(3);
    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(result.current.commonPlan?.sessions.every((session) =>
      session.unitIds.join(",") === "unit-1,unit-2")).toBe(true);
  });

  it("문항 수는 전체가 기본이고 직접 입력값과 출제 대상을 별도로 보존한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    const initialNonce = result.current.planner.planNonce;
    expect(result.current.commonPlan).toMatchObject({
      questionCount: { mode: "all" },
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 0,
      selectionMode: "source_order",
    });

    act(() => {
      result.current.actions.changeQuestionCountMode("manual");
      result.current.actions.changeManualQuestionCount(20);
      result.current.actions.changeOverflowPolicy("continue_weekly");
      result.current.actions.changeSelectionMode("random");
      result.current.actions.toggleWeekday(3);
    });
    expect(result.current.commonPlan).toMatchObject({
      questionCount: { mode: "manual", value: 20 },
      overflowPolicy: "continue_weekly",
      selectionMode: "random",
      planNonce: initialNonce,
    });
    expect(result.current.planner.planNonce).toBe(initialNonce);

    act(() => result.current.actions.changeQuestionCountMode("all"));
    expect(result.current.planner.manualQuestionCount).toBe(20);
    expect(result.current.commonPlan?.questionCount).toEqual({ mode: "all" });
  });

  it("요일을 3개에서 2개로 줄였다 다시 늘리면 공통 계획도 3→2→3회로 동기화한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);
    expect(result.current.commonPlan?.sessions).toHaveLength(3);

    act(() => result.current.actions.toggleWeekday(3));
    expect(result.current.commonPlan?.sessions).toHaveLength(2);
    expect(result.current.commonPlan?.sessions.map((session) =>
      session.availableLocalDateTime.slice(0, 10))).toEqual([
      "2026-08-21",
      "2026-08-24",
    ]);

    act(() => result.current.actions.toggleWeekday(3));
    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(mocks.changeCommonPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessions: expect.arrayContaining([
        expect.objectContaining({
          availableLocalDateTime: "2026-08-21T16:00",
        }),
        expect.objectContaining({
          availableLocalDateTime: "2026-08-24T16:00",
        }),
        expect.objectContaining({
          availableLocalDateTime: "2026-08-26T16:00",
        }),
      ]) }),
    );
  });

  it("한 회차 날짜를 바꿔도 다음 주 반복 기준은 원래 월수금으로 보존한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);

    act(() => {
      result.current.actions.updateSessionSchedule(2, {
        availableLocalDateTime: "2026-08-25T16:00",
        deadlineLocalDateTime: "2026-08-26T22:00",
      });
    });

    expect(result.current.commonPlan?.sessions.map((session) =>
      session.availableLocalDateTime.slice(0, 10))).toEqual([
      "2026-08-21",
      "2026-08-25",
      "2026-08-26",
    ]);
    expect(result.current.commonPlan?.recurrenceSessions.map((session) =>
      session.availableLocalDateTime.slice(0, 10))).toEqual([
      "2026-08-21",
      "2026-08-24",
      "2026-08-26",
    ]);
  });

  it("추가 날짜 확인 결과를 공통 계획에 반영하고 조건 변경 시 초기화한다", () => {
    mocks.preview = {
      commonPlanSummary: null,
      items: [{
        defaultSessionCount: 2,
        error: null,
        requiresExtraDateDecision: true,
        scheduledQuestionCount: 80,
      }],
    };
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);

    expect(result.current.requiresExtraDateDecision).toBe(true);
    expect(result.current.fieldErrors.weekdays).toMatch(/반복 여부/);

    mocks.preview = {
      commonPlanSummary: null,
      items: [{
        defaultSessionCount: 2,
        error: null,
        requiresExtraDateDecision: false,
        scheduledQuestionCount: 125,
      }],
    };
    act(() =>
      result.current.actions.changeExtraDatePolicy("repeat_from_start"),
    );
    expect(result.current.commonPlan?.extraDatePolicy).toBe(
      "repeat_from_start",
    );

    act(() => result.current.actions.changeManualQuestionCount(45));
    expect(result.current.planner.extraDatePolicy).toBe("unconfirmed");
  });

  it("학생별 기본 회차가 다르면 추가 취소는 경고 학생 중 가장 짧은 회차에 맞춘다", () => {
    mocks.preview = {
      commonPlanSummary: null,
      items: [
        {
          defaultSessionCount: 3,
          error: null,
          requiresExtraDateDecision: false,
          scheduledQuestionCount: 120,
        },
        {
          defaultSessionCount: 2,
          error: null,
          requiresExtraDateDecision: true,
          scheduledQuestionCount: 80,
        },
      ],
    };
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);

    expect(result.current.extraDateDecisionSessionCount).toBe(2);
    act(() => result.current.actions.cancelExtraDates());
    expect(result.current.planner.schedule.weekdays).toEqual([5, 1]);
  });
});
