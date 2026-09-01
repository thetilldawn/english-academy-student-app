// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { PreviousVocabExamSource } from "../domain/vocab-previous-exam";
import { useVocabAssignmentPlanner } from "./use-vocab-assignment-planner";

const mocks = vi.hoisted(() => ({
  changeCommonPlan: vi.fn(),
  changeOrder: vi.fn(),
  changeRetryEnabled: vi.fn(),
  changeRetryPassingScore: vi.fn(),
  previousExam: null as PreviousVocabExamSource | null,
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
      changeOrder: mocks.changeOrder,
      changePassingScore: vi.fn(),
      changeRetryEnabled: mocks.changeRetryEnabled,
      changeRetryPassingScore: mocks.changeRetryPassingScore,
      changeTimeLimitEnabled: vi.fn(),
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

vi.mock("./use-assignment-previous-exam", () => ({
  useAssignmentPreviousExam: () => ({
    data: mocks.previousExam,
    error: "",
    retry: vi.fn(),
    status: "ready",
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

function renderPlanner(
  plannerUnits = units,
  previousExam: PreviousVocabExamSource | null = null,
) {
  mocks.previousExam = previousExam;
  return renderHook(() => useVocabAssignmentPlanner({
    datasets: [dataset],
    genericErrorMessage: "저장 실패",
    initialDatasetId: dataset.id,
    previousExamSourceStudentId: "student-a",
    previewErrorMessage: "미리보기 실패",
    studentIds: ["student-a"],
    today: "2026-08-21",
    units: plannerUnits,
  }));
}

function selectWholeRange(
  result: ReturnType<typeof renderPlanner>["result"],
) {
  act(() => {
    result.current.actions.selectAllUnits(true);
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

function scheduledLocalDate(value: string | null) {
  if (!value) throw new Error("expected a scheduled local date-time");
  return value.slice(0, 10);
}

describe("단어 배정 일정 controller", () => {
  beforeEach(() => {
    mocks.changeCommonPlan.mockReset();
    mocks.changeOrder.mockReset();
    mocks.changeRetryEnabled.mockReset();
    mocks.changeRetryPassingScore.mockReset();
    mocks.previousExam = null;
    mocks.preview = null;
  });

  it("요일은 처음에 비어 있고 월수금을 고르면 가까운 세 날짜를 만든다", () => {
    const { result } = renderHook(() => useVocabAssignmentPlanner({
      datasets: [],
      genericErrorMessage: "저장 실패",
      initialDatasetId: "",
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

  it("시험일을 끄면 요일과 마감 없이 바로 시작하는 한 회차만 만든다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);

    act(() => result.current.actions.changeScheduleEnabled(false));

    expect(result.current.scheduleSlots).toEqual([]);
    expect(result.current.commonPlan).toMatchObject({
      distribution: "repeat",
      splitBasis: "question_count",
      selectedDateCount: 0,
      questionCount: { mode: "all" },
      overflowPolicy: "leave",
      sessions: [{
        availableLocalDateTime: null,
        deadlineLocalDateTime: null,
        unitIds: units.map((unit) => unit.id),
      }],
    });
  });

  it("단어 수 배정은 시험일을 꺼도 입력한 수로 바로 시작하는 한 회차를 만든다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);

    act(() => {
      result.current.actions.changeAssignmentMode("word_count");
      result.current.actions.activateManualQuestionCount(120);
      result.current.actions.changeManualQuestionCount(4);
      result.current.actions.changeOverflowPolicy("continue_weekly");
      result.current.actions.changeScheduleEnabled(false);
    });

    expect(result.current.planner).toMatchObject({
      assignmentMode: "word_count",
      manualQuestionCount: 4,
      questionCountMode: "manual",
      overflowPolicy: "continue_weekly",
      scheduleEnabled: false,
    });
    expect(result.current.commonPlan).toMatchObject({
      distribution: "repeat",
      questionCount: { mode: "manual", value: 4 },
      selectedDateCount: 0,
      sessions: [{
        availableLocalDateTime: null,
        deadlineLocalDateTime: null,
        unitIds: units.map((unit) => unit.id),
      }],
    });
  });

  it("전체 회차는 같은 범위를 월수금 세 날짜에 정확히 한 번씩 배정한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);
    act(() => result.current.actions.changeAssignmentMode("all_sessions"));

    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: scheduledLocalDate(session.availableLocalDateTime),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-21", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-24", unitIds: units.map((unit) => unit.id) },
      { date: "2026-08-26", unitIds: units.map((unit) => unit.id) },
    ]);
  });

  it("단어 수 방식은 모든 회차에 전체 범위를 보내고 서버가 단어를 나눈다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);
    act(() => result.current.actions.changeAssignmentMode("word_count"));

    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: scheduledLocalDate(session.availableLocalDateTime),
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

  it("단어 수는 전체가 기본이고 직접 입력값과 문제 순서를 별도로 보존한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    const initialNonce = result.current.planner.planNonce;
    act(() => result.current.actions.changeAssignmentMode("word_count"));
    expect(result.current.commonPlan).toMatchObject({
      questionCount: { mode: "all" },
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 0,
      selectionMode: "source_order",
    });

    act(() => {
      result.current.actions.activateManualQuestionCount(120);
      result.current.actions.changeManualQuestionCount(20);
      result.current.actions.changeOverflowPolicy("continue_weekly");
      result.current.actions.changeSelectionMode("random");
      result.current.actions.toggleWeekday(3);
    });
    expect(mocks.changeOrder).not.toHaveBeenCalled();
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

    act(() => {
      result.current.actions.changeAssignmentMode("all_sessions");
      result.current.actions.changeAssignmentMode("word_count");
    });
    expect(result.current.planner.manualQuestionCount).toBe(20);
  });

  it("요일을 3개에서 2개로 줄였다 다시 늘리면 공통 계획도 3→2→3회로 동기화한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    selectMondayWednesdayFriday(result);
    expect(result.current.commonPlan?.sessions).toHaveLength(3);

    act(() => result.current.actions.toggleWeekday(3));
    expect(result.current.commonPlan?.sessions).toHaveLength(2);
    expect(result.current.commonPlan?.sessions.map((session) =>
      scheduledLocalDate(session.availableLocalDateTime))).toEqual([
      "2026-08-21",
      "2026-08-24",
    ]);

    act(() => result.current.actions.toggleWeekday(3));
    expect(result.current.commonPlan?.sessions).toHaveLength(3);
    expect(mocks.changeCommonPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessions: expect.arrayContaining([
        expect.objectContaining({
          availableLocalDateTime: "2026-08-21T00:00",
        }),
        expect.objectContaining({
          availableLocalDateTime: "2026-08-24T00:00",
        }),
        expect.objectContaining({
          availableLocalDateTime: "2026-08-26T00:00",
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
      scheduledLocalDate(session.availableLocalDateTime))).toEqual([
      "2026-08-21",
      "2026-08-25",
      "2026-08-26",
    ]);
    expect(result.current.commonPlan?.recurrenceSessions.map((session) =>
      scheduledLocalDate(session.availableLocalDateTime))).toEqual([
      "2026-08-21",
      "2026-08-24",
      "2026-08-26",
    ]);
  });

  it("공개 시간을 꺼도 회차별 시간은 보존하고 실제 배정에는 자정을 적용한다", () => {
    const { result } = renderPlanner();
    selectWholeRange(result);
    act(() => {
      result.current.actions.toggleWeekday(1);
      result.current.actions.updateSessionSchedule(1, {
        availableLocalDateTime: "2026-08-24T17:30",
        deadlineLocalDateTime: "2026-08-24T23:00",
      });
      result.current.actions.updateSchedule({ availableTimeEnabled: false });
    });

    expect(result.current.planner.sessionScheduleOverrides[1]).toEqual({
      availableLocalDateTime: "2026-08-24T17:30",
      deadlineLocalDateTime: "2026-08-24T23:00",
    });
    expect(result.current.commonPlan?.sessions[0]).toMatchObject({
      availableLocalDateTime: "2026-08-24T00:00",
      deadlineLocalDateTime: "2026-08-24T23:00",
    });

    act(() => {
      result.current.actions.updateSchedule({ availableTimeEnabled: true });
    });
    expect(result.current.commonPlan?.sessions[0]).toMatchObject({
      availableLocalDateTime: "2026-08-24T17:30",
      deadlineLocalDateTime: "2026-08-24T23:00",
    });
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

  it("회차별은 월·수에 범위를 하나씩 배정하고 남은 범위를 다음 주로 잇는다", () => {
    const { result } = renderPlanner();
    act(() => {
      result.current.actions.selectAllUnits(true);
      result.current.actions.toggleWeekday(1);
      result.current.actions.toggleWeekday(3);
      result.current.actions.changeAssignmentMode("per_session");
      result.current.actions.changeOverflowPolicy("continue_weekly");
    });

    expect(result.current.commonPlan).toMatchObject({
      splitBasis: "range_unit",
      orderedUnitIds: units.map((unit) => unit.id),
      rangeUnitCounts: [1, 1],
      overflowPolicy: "continue_weekly",
    });
    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: scheduledLocalDate(session.availableLocalDateTime),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-24", unitIds: ["unit-1"] },
      { date: "2026-08-26", unitIds: ["unit-2"] },
      { date: "2026-08-31", unitIds: ["unit-3"] },
      { date: "2026-09-02", unitIds: ["unit-4"] },
      { date: "2026-09-07", unitIds: ["unit-5"] },
      { date: "2026-09-09", unitIds: ["unit-6"] },
    ]);
  });

  it("월 2단위·수 3단위를 원래 요일 순서로 이어 배정한다", () => {
    const eightUnits = Array.from({ length: 8 }, (_, index) => ({
      ...units[index % units.length]!,
      id: `weekday-unit-${index + 1}`,
      label: `DAY ${index + 1}`,
      displayName: `DAY ${index + 1}`,
      number: index + 1,
      sortIndex: index + 1,
    }));
    const { result } = renderPlanner(eightUnits);
    act(() => {
      result.current.actions.selectAllUnits(true);
      result.current.actions.toggleWeekday(1);
      result.current.actions.toggleWeekday(3);
      result.current.actions.changeAssignmentMode("per_session");
      result.current.actions.changeUnitAllocationMode("by_weekday");
      result.current.actions.changeWeekdayUnitsPerSession(1, 2);
      result.current.actions.changeWeekdayUnitsPerSession(3, 3);
      result.current.actions.changeOverflowPolicy("continue_weekly");
    });

    expect(result.current.commonPlan).toMatchObject({
      rangeUnitCounts: [2, 3],
      unitAllocationRule: {
        schemaVersion: 1,
        mode: "by_weekday",
        weekdayUnitsPerSession: { 1: 2, 3: 3 },
      },
    });
    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: scheduledLocalDate(session.availableLocalDateTime),
      unitIds: session.unitIds,
    }))).toEqual([
      {
        date: "2026-08-24",
        unitIds: ["weekday-unit-1", "weekday-unit-2"],
      },
      {
        date: "2026-08-26",
        unitIds: ["weekday-unit-3", "weekday-unit-4", "weekday-unit-5"],
      },
      {
        date: "2026-08-31",
        unitIds: ["weekday-unit-6", "weekday-unit-7"],
      },
      { date: "2026-09-02", unitIds: ["weekday-unit-8"] },
    ]);

    act(() => result.current.actions.updateSessionSchedule(2, {
      availableLocalDateTime: "2026-08-27T16:00",
      deadlineLocalDateTime: "2026-08-28T22:00",
    }));
    expect(result.current.commonPlan?.rangeUnitCounts).toEqual([2, 3]);
    expect(result.current.commonPlan?.sessions[1]).toMatchObject({
      availableLocalDateTime: "2026-08-27T00:00",
      unitIds: ["weekday-unit-3", "weekday-unit-4", "weekday-unit-5"],
    });
  });

  it("최근 시험 복사는 저장된 요일별 원 규칙을 새 계획에 복원한다", () => {
    const previous = {
      assignmentDeleted: false,
      assignmentId: "assignment-previous",
      assignmentPurpose: "regular",
      assignmentTitle: "이전 시험",
      assignedAt: "2026-08-20T00:00:00.000Z",
      availableFrom: "2026-08-20T07:00:00.000Z",
      availableUntil: "2026-08-20T13:00:00.000Z",
      datasetId: dataset.id,
      datasetTitle: dataset.title,
      englishToKoreanRatio: 50,
      passingScore: 80,
      questionOrderMode: "ascending",
      questionTimeLimitSeconds: null,
      status: "completed",
      studentId: "student-a",
      studentName: "학생",
      timeLimitSeconds: 300,
      timingMode: "total",
      vocabUnitAllocation: {
        rule: {
          schemaVersion: 1,
          mode: "by_weekday",
          unitsPerSession: 2,
          weekdayUnitsPerSession: {
            1: 2, 2: 1, 3: 3, 4: 1, 5: 1, 6: 1, 7: 1,
          },
        },
        overflowPolicy: "continue_weekly",
      },
    } as PreviousVocabExamSource;
    const { result } = renderPlanner(units, previous);
    act(() => {
      result.current.actions.selectAllUnits(true);
      result.current.actions.toggleWeekday(1);
      result.current.actions.toggleWeekday(3);
      result.current.actions.changeScheduleEnabled(false);
    });

    let copied = false;
    act(() => {
      copied = result.current.actions.copyPreviousExam();
    });
    expect(copied).toBe(true);
    expect(result.current.planner).toMatchObject({
      assignmentMode: "per_session",
      scheduleEnabled: true,
      unitAllocationMode: "by_weekday",
      unitsPerSession: 2,
      weekdayUnitsPerSession: { 1: 2, 3: 3 },
      overflowPolicy: "continue_weekly",
    });
    expect(result.current.commonPlan?.rangeUnitCounts).toEqual([2, 3]);
    expect(mocks.changeOrder).toHaveBeenCalledWith("ascending");
  });

  it("비연속 범위도 처음 정한 역방향으로 회차별 배정한다", () => {
    const { result } = renderPlanner();
    act(() => {
      result.current.actions.selectUnit(units[5]!.id);
      result.current.actions.selectUnit(units[0]!.id);
      result.current.actions.selectUnit(units[2]!.id);
      result.current.actions.toggleWeekday(1);
      result.current.actions.toggleWeekday(3);
      result.current.actions.changeAssignmentMode("per_session");
      result.current.actions.changeOverflowPolicy("continue_weekly");
    });

    expect(result.current.commonPlan?.rangeUnitCounts).toEqual([1, 1]);
    expect(result.current.commonPlan?.sessions.map((session) =>
      session.unitIds)).toEqual([
      ["unit-6"],
      ["unit-3"],
      ["unit-1"],
    ]);
  });

  it("회차 날짜를 옮겨도 회차별 범위 순서를 유지한다", () => {
    const { result } = renderPlanner();
    act(() => {
      result.current.actions.selectAllUnits(true);
      result.current.actions.toggleWeekday(1);
      result.current.actions.toggleWeekday(3);
      result.current.actions.changeAssignmentMode("per_session");
      result.current.actions.changeOverflowPolicy("continue_weekly");
      result.current.actions.updateSessionSchedule(2, {
        availableLocalDateTime: "2026-08-27T16:00",
        deadlineLocalDateTime: "2026-08-28T22:00",
      });
    });

    expect(result.current.commonPlan?.rangeUnitCounts).toEqual([1, 1]);
    expect(result.current.commonPlan?.sessions.map((session) => ({
      date: scheduledLocalDate(session.availableLocalDateTime),
      unitIds: session.unitIds,
    }))).toEqual([
      { date: "2026-08-24", unitIds: ["unit-1"] },
      { date: "2026-08-27", unitIds: ["unit-2"] },
      { date: "2026-08-31", unitIds: ["unit-3"] },
      { date: "2026-09-02", unitIds: ["unit-4"] },
      { date: "2026-09-07", unitIds: ["unit-5"] },
      { date: "2026-09-09", unitIds: ["unit-6"] },
    ]);
  });
});
