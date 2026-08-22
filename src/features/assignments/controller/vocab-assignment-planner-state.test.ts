import { describe, expect, it } from "vitest";

import type { VocabPlannerState } from "./vocab-assignment-planner-state";
import { vocabPlannerReducer } from "./vocab-assignment-planner-state";

const state: VocabPlannerState = {
  datasetId: "dataset-a",
  range: { startUnitId: "unit-1", endUnitId: "unit-2" },
  distribution: "split",
  splitBasis: "question_count",
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
  collisionDecisionRecords: [],
};

describe("vocabPlannerReducer extra date decision", () => {
  it("범위 단위를 선택해도 교사가 고르기 전에는 다음 주 이어 배정을 켜지 않는다", () => {
    expect(vocabPlannerReducer({
      ...state,
      overflowPolicy: "continue_weekly",
    }, {
      type: "split_basis",
      value: "range_unit",
    }).overflowPolicy).toBe("leave");
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
