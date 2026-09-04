import { describe, expect, it } from "vitest";

import type { VocabPlannerState } from "./vocab-assignment-planner-state";
import {
  createInitialVocabPlannerState,
  resolveInitialVocabDeadline,
  vocabPlannerReducer,
} from "./vocab-assignment-planner-state";

const state: VocabPlannerState = {
  datasetId: "dataset-a",
  range: { selectedUnitIds: ["unit-1", "unit-2"] },
  assignmentMode: "word_count",
  unitsPerSession: 2,
  questionCountMode: "manual",
  manualQuestionCount: 45,
  overflowPolicy: "leave",
  extraDatePolicy: "repeat_from_start",
  selectionMode: "source_order",
  planNonce: "11111111-1111-4111-8111-111111111111",
  schedule: {
    startDate: "2026-08-22",
    weekdays: [1, 3, 5],
    availableTime: "16:00",
    deadlineDayOffset: 1,
    deadlineTime: "22:00",
  },
  sessionScheduleOverrides: {},
};

const units = [1, 2, 3].map((sortIndex) => ({
  id: `unit-${sortIndex}`,
  sortIndex,
}));

describe("vocabPlannerReducer extra date decision", () => {
  it("새 배정은 전체 회차·즉시 공개·당일 마감으로 시작한다", () => {
    expect(createInitialVocabPlannerState([], "", "2026-08-24")).toMatchObject({
      assignmentMode: "all_sessions",
      schedule: {
        availableTimeEnabled: false,
        deadlineDayOffset: 0,
      },
    });
  });

  it("늦은 시각에도 기본 마감이 과거가 되지 않도록 안전 여유를 둔다", () => {
    expect(resolveInitialVocabDeadline(
      "2026-08-24",
      "2026-08-24T21:30",
    )).toEqual({ dayOffset: 0, time: "22:00" });
    expect(resolveInitialVocabDeadline(
      "2026-08-24",
      "2026-08-24T22:15",
    )).toEqual({ dayOffset: 0, time: "23:59" });
    expect(resolveInitialVocabDeadline(
      "2026-08-24",
      "2026-08-24T23:50",
    )).toEqual({ dayOffset: 1, time: "22:00" });
  });

  it("범위를 각각 토글하고 전체 선택·해제한다", () => {
    expect(vocabPlannerReducer(state, {
      type: "range/toggle",
      unitId: "unit-2",
      units,
    }).range).toEqual({ selectedUnitIds: ["unit-1"] });
    expect(vocabPlannerReducer(state, {
      type: "range/all",
      unitIds: ["unit-1", "unit-2", "unit-3"],
      selectAll: true,
    }).range).toEqual({
      selectedUnitIds: ["unit-1", "unit-2", "unit-3"],
    });
    expect(vocabPlannerReducer(state, {
      type: "range/all",
      unitIds: ["unit-1", "unit-2"],
      selectAll: false,
    }).range).toEqual({ selectedUnitIds: [] });
  });

  it("첫 두 선택의 방향으로 비연속 범위를 정규화해 상태에 저장한다", () => {
    const initial = { ...state, range: { selectedUnitIds: [] } };
    const first = vocabPlannerReducer(initial, {
      type: "range/toggle",
      unitId: "unit-3",
      units,
    });
    const second = vocabPlannerReducer(first, {
      type: "range/toggle",
      unitId: "unit-1",
      units,
    });
    const third = vocabPlannerReducer(second, {
      type: "range/toggle",
      unitId: "unit-2",
      units,
    });

    expect(third.range).toEqual({
      selectedUnitIds: ["unit-3", "unit-2", "unit-1"],
    });
    expect(vocabPlannerReducer(third, {
      type: "range/toggle",
      unitId: "unit-3",
      units,
    }).range).toEqual({
      selectedUnitIds: ["unit-2", "unit-1"],
    });
  });

  it("배정 방식을 바꿔도 직접 입력한 단어 수를 보존한다", () => {
    const allSessions = vocabPlannerReducer({
      ...state,
      overflowPolicy: "continue_weekly",
    }, {
      type: "assignment_mode",
      value: "all_sessions",
    });
    expect(allSessions).toMatchObject({
      assignmentMode: "all_sessions",
      manualQuestionCount: 45,
      questionCountMode: "manual",
      overflowPolicy: "leave",
    });

    expect(vocabPlannerReducer(allSessions, {
      type: "assignment_mode",
      value: "word_count",
    })).toMatchObject({
      assignmentMode: "word_count",
      manualQuestionCount: 45,
      questionCountMode: "manual",
    });
  });

  it("회차당 단위 수를 바꾸면 범위 반복 결정을 다시 받는다", () => {
    const commonChanged = vocabPlannerReducer(state, {
      type: "units_per_session",
      value: 5,
    });

    expect(commonChanged).toMatchObject({
      unitsPerSession: 5,
      extraDatePolicy: "unconfirmed",
    });
  });

  it("시간·기준일·시간 템플릿 변경 뒤에도 범위 반복 결정을 유지한다", () => {
    const changedTime = vocabPlannerReducer(state, {
      type: "schedule/update",
      patch: { availableTime: "17:00", startDate: "2026-08-23" },
    });
    expect(changedTime.extraDatePolicy).toBe("repeat_from_start");

    const appliedTemplate = vocabPlannerReducer(state, {
      type: "schedule/replace",
      value: { ...state.schedule, availableTime: "18:00" },
    });
    expect(appliedTemplate.extraDatePolicy).toBe("repeat_from_start");
  });

  it("공개 시간 토글은 회차별 공개·마감 수정값을 보존한다", () => {
    const withOverride = {
      ...state,
      sessionScheduleOverrides: {
        2: {
          availableLocalDateTime: "2026-08-26T17:00",
          deadlineLocalDateTime: "2026-08-26T22:30",
        },
      },
    };
    const toggled = vocabPlannerReducer(withOverride, {
      type: "schedule/update",
      patch: { availableTimeEnabled: false },
    });
    expect(toggled.sessionScheduleOverrides).toEqual(
      withOverride.sessionScheduleOverrides,
    );
  });

  it("시험일을 끄면 단순한 전체 범위 1회 배정으로 맞춘다", () => {
    const disabled = vocabPlannerReducer({
      ...state,
      assignmentMode: "per_session",
      overflowPolicy: "continue_weekly",
    }, {
      type: "schedule/enabled",
      enabled: false,
    });
    expect(disabled).toMatchObject({
      assignmentMode: "all_sessions",
      overflowPolicy: "leave",
      scheduleEnabled: false,
    });
  });

  it("단어 수 배정은 시험일을 꺼도 입력한 수와 남은 범위 방식을 보존한다", () => {
    const disabled = vocabPlannerReducer({
      ...state,
      manualQuestionCount: 4,
      overflowPolicy: "continue_weekly",
    }, {
      type: "schedule/enabled",
      enabled: false,
    });

    expect(disabled).toMatchObject({
      assignmentMode: "word_count",
      manualQuestionCount: 4,
      questionCountMode: "manual",
      overflowPolicy: "continue_weekly",
      scheduleEnabled: false,
    });
  });

  it("요일이 달라질 때만 범위 반복 결정을 다시 확인한다", () => {
    expect(vocabPlannerReducer(state, {
      type: "schedule/update",
      patch: { weekdays: [1, 3] },
    }).extraDatePolicy).toBe("unconfirmed");

    expect(vocabPlannerReducer(state, {
      type: "schedule/replace",
      value: { ...state.schedule, weekdays: [1, 5] },
    }).extraDatePolicy).toBe("unconfirmed");
  });
});
