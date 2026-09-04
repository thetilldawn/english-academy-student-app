import { describe, expect, it } from "vitest";

import type { ExamSettings } from "./model";
import {
  resolveVocabAssignmentMode,
} from "./vocab-assignment-contract";
import {
  rebalanceHalfRatioSplitQuestionCounts,
  resolveVocabQuestionCapacityScope,
  resolveVocabQuestionCycleAllocation,
  resolveVocabQuestionAllocation,
  splitVocabTargetPoolPreparationCounts,
} from "./vocab-question-allocation";
import {
  planDirectionalVocabSeriesTargetIds,
  planDirectionalVocabSeriesTargets,
  planVocabSeriesTargetIds,
} from "./vocab-series-target-planner";
import {
  applyScheduleSlotOverride,
  applyTimeTemplate,
  copyPreviousExamConditions,
  resolveVocabUnitSelection,
  selectAllVocabUnits,
  selectInitialVocabDatasetId,
  toggleWeekday,
  toggleVocabUnitSelection,
} from "./vocab-planner-controls";
import {
  buildScheduleSlots,
  buildSelectedWeekdayDates,
  extendScheduleSlots,
  extendScheduleSlotsFromRecurrence,
  approveVocabRepeatCycle,
  reconcileVocabRepeatCycleApproval,
  resolveVocabRepeatCycleCount,
  resolveVocabBaseSessionUnitCounts,
} from "./vocab-schedule";
import { resolveVocabUnitCycleAllocation } from "./vocab-unit-allocation";

const exam: ExamSettings = {
  directionRatio: 50,
  passingScore: 80,
  questionOrderMode: "random",
  timing: { mode: "total", totalSeconds: 300 },
};

function targetSetCanMeetEnglishCount(
  ids: readonly number[],
  englishCount: number,
  directionById: ReadonlyMap<number, "english" | "korean" | "both">,
) {
  const englishOnly = ids.filter((id) => directionById.get(id) === "english").length;
  const koreanOnly = ids.filter((id) => directionById.get(id) === "korean").length;
  const both = ids.length - englishOnly - koreanOnly;
  return (
    englishOnly <= englishCount &&
    koreanOnly <= ids.length - englishCount &&
    englishCount - englishOnly >= 0 &&
    englishCount - englishOnly <= both
  );
}

describe("단어 시험 공통 배정 계획", () => {
  it("날짜 수를 기본 회차 단위의 범위 바퀴로 계산한다", () => {
    expect(resolveVocabRepeatCycleCount(4, 2)).toBe(2);
    expect(resolveVocabRepeatCycleCount(5, 2)).toBe(3);
    expect(approveVocabRepeatCycle({
      selectedDateCount: 3,
      baseSessionCount: 2,
    })).toEqual({
      approvedCycleCount: 2,
      extraDatePolicy: "repeat_from_start",
    });
    expect(reconcileVocabRepeatCycleApproval({
      approvedCycleCount: 2,
      selectedDateCount: 5,
      baseSessionCount: 2,
    })).toEqual({
      approvedCycleCount: 2,
      extraDatePolicy: "unconfirmed",
      requiredCycleCount: 3,
    });
    expect(reconcileVocabRepeatCycleApproval({
      approvedCycleCount: 3,
      selectedDateCount: 4,
      baseSessionCount: 2,
    })).toEqual({
      approvedCycleCount: 2,
      extraDatePolicy: "repeat_from_start",
      requiredCycleCount: 2,
    });
  });

  it("세 배정 방식을 기존 저장 계약으로 변환한다", () => {
    expect(resolveVocabAssignmentMode("all_sessions")).toEqual({
      distribution: "repeat",
      splitBasis: "question_count",
    });
    expect(resolveVocabAssignmentMode("per_session")).toEqual({
      distribution: "split",
      splitBasis: "range_unit",
    });
    expect(resolveVocabAssignmentMode("word_count")).toEqual({
      distribution: "split",
      splitBasis: "question_count",
    });
  });

  it("선택 범위를 회차당 단위 수로 나누고 마지막 한 단위를 보존한다", () => {
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds: ["1", "2", "3", "4", "5"],
      baseSessionUnitCounts: [2, 2],
      selectedDateCount: 2,
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      sessionUnitIds: [["1", "2"], ["3", "4"], ["5"]],
      remainingUnitIds: [],
      defaultSessionCount: 3,
      sessionCycleIndexes: [0, 0, 0],
      issue: null,
    });
  });

  it("역방향 범위를 다시 정렬하지 않고 요일별 단위 수를 반복한다", () => {
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds: ["8", "7", "6", "5", "4", "3", "2", "1"],
      baseSessionUnitCounts: [2, 3],
      selectedDateCount: 2,
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
    }).sessionUnitIds).toEqual([
      ["8", "7"],
      ["6", "5", "4"],
      ["3", "2"],
      ["1"],
    ]);
  });

  it("선택한 날짜 순서대로 요일별 단위 수를 연결한다", () => {
    const slots = buildScheduleSlots({
      startDate: "2026-08-24",
      weekdays: [1, 3],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    });
    expect(resolveVocabBaseSessionUnitCounts({
      slots,
      mode: "by_weekday",
      unitsPerSession: 9,
      weekdayUnitsPerSession: {
        1: 2,
        2: 1,
        3: 3,
        4: 1,
        5: 1,
        6: 1,
        7: 1,
      },
    })).toEqual([2, 3]);
  });

  it("이번 일정만이면 남은 단위를 반환하고 날짜가 많으면 반복 결정을 요구한다", () => {
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds: ["1", "2", "3", "4", "5"],
      baseSessionUnitCounts: [2, 2],
      selectedDateCount: 2,
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      sessionUnitIds: [["1", "2"], ["3", "4"]],
      remainingUnitIds: ["5"],
      requiresExtraDateDecision: false,
    });
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds: ["1", "2"],
      baseSessionUnitCounts: [2, 2, 2],
      selectedDateCount: 3,
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      sessionUnitIds: [["1", "2"]],
      requiresExtraDateDecision: true,
    });
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds: ["1", "2"],
      baseSessionUnitCounts: [2, 2, 2],
      selectedDateCount: 3,
      overflowPolicy: "leave",
      extraDatePolicy: "repeat_from_start",
    })).toMatchObject({
      sessionUnitIds: [["1", "2"], ["1", "2"], ["1", "2"]],
      sessionCycleIndexes: [0, 1, 2],
      requiresExtraDateDecision: false,
    });
  });

  it("저장된 과거 회차별 단위 규칙도 반복 계산에서 유지한다", () => {
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds: ["1", "2", "3", "4", "5"],
      baseSessionUnitCounts: [2, 3, 4],
      selectedDateCount: 3,
      overflowPolicy: "leave",
      extraDatePolicy: "repeat_from_start",
    })).toMatchObject({
      sessionUnitIds: [
        ["1", "2"],
        ["3", "4", "5"],
        ["1", "2", "3", "4"],
      ],
      sessionCycleIndexes: [0, 0, 1],
      defaultSessionCount: 2,
      requiresExtraDateDecision: false,
    });
  });

  it("25단위를 5개씩 7회 배정하면 5회 완주 뒤 앞의 10단위를 반복한다", () => {
    const orderedUnitIds = Array.from(
      { length: 25 },
      (_, index) => `${index + 1}`,
    );
    expect(resolveVocabUnitCycleAllocation({
      orderedUnitIds,
      baseSessionUnitCounts: Array.from({ length: 7 }, () => 5),
      selectedDateCount: 7,
      overflowPolicy: "leave",
      extraDatePolicy: "repeat_from_start",
    })).toMatchObject({
      sessionUnitIds: [
        ["1", "2", "3", "4", "5"],
        ["6", "7", "8", "9", "10"],
        ["11", "12", "13", "14", "15"],
        ["16", "17", "18", "19", "20"],
        ["21", "22", "23", "24", "25"],
        ["1", "2", "3", "4", "5"],
        ["6", "7", "8", "9", "10"],
      ],
      sessionCycleIndexes: [0, 0, 0, 0, 0, 1, 1],
      defaultSessionCount: 5,
      remainingUnitIds: [],
      requiresExtraDateDecision: false,
      issue: null,
    });
  });

  it("이번 일정만 선택하면 전체 기본 회차가 210회를 넘어도 선택 날짜만 만든다", () => {
    const allocation = resolveVocabUnitCycleAllocation({
      orderedUnitIds: Array.from({ length: 500 }, (_, index) => `${index + 1}`),
      baseSessionUnitCounts: [1, 1, 1, 1, 1, 1, 1],
      selectedDateCount: 7,
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
    });
    expect(allocation).toMatchObject({
      defaultSessionCount: 500,
      issue: null,
    });
    expect(allocation.sessionUnitIds).toHaveLength(7);
    expect(allocation.remainingUnitIds).toHaveLength(493);
  });

  it("공통 단어장이 명확하지 않으면 첫 자료를 조용히 고르지 않는다", () => {
    const datasets = [{ id: "dataset-a" }, { id: "dataset-b" }];
    expect(selectInitialVocabDatasetId(datasets, "")).toBe("");
    expect(selectInitialVocabDatasetId(datasets, "dataset-b")).toBe(
      "dataset-b",
    );
  });

  it("배정 기준일부터 가까운 선택 요일을 달력 순서로 한 번씩 만든다", () => {
    expect(buildSelectedWeekdayDates({
      startDate: "2026-08-17",
      weekdays: [1, 3, 5],
    })).toEqual(["2026-08-17", "2026-08-19", "2026-08-21"]);
    expect(buildSelectedWeekdayDates({
      startDate: "2026-08-21",
      weekdays: [1, 3, 5],
    })).toEqual(["2026-08-21", "2026-08-24", "2026-08-26"]);
    expect(buildSelectedWeekdayDates({
      startDate: "2026-08-22",
      weekdays: [7, 1, 6],
    })).toEqual(["2026-08-22", "2026-08-23", "2026-08-24"]);
  });

  it("요일을 다시 누르면 해제하고 시작일이 잘못되면 빈 후보를 반환한다", () => {
    expect(toggleWeekday([1, 3, 5], 3)).toEqual([1, 5]);
    expect(toggleWeekday([1, 5], 3)).toEqual([1, 3, 5]);
    expect(buildSelectedWeekdayDates({
      startDate: "not-a-date",
      weekdays: [1],
    })).toEqual([]);
    expect(buildSelectedWeekdayDates({
      startDate: "2026-08-17",
      weekdays: [],
    })).toEqual([]);
  });

  it("공개 시각과 다음 날 마감을 회차별 후보로 만든다", () => {
    expect(buildScheduleSlots({
      startDate: "2026-08-17",
      weekdays: [1, 3],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    })).toEqual([
      {
        sessionNumber: 1,
        date: "2026-08-17",
        availableLocalDateTime: "2026-08-17T16:00",
        deadlineLocalDateTime: "2026-08-18T22:00",
      },
      {
        sessionNumber: 2,
        date: "2026-08-19",
        availableLocalDateTime: "2026-08-19T16:00",
        deadlineLocalDateTime: "2026-08-20T22:00",
      },
    ]);
  });

  it("공개 시간을 사용하지 않으면 시험일 자정부터 바로 공개한다", () => {
    expect(buildScheduleSlots({
      startDate: "2026-08-17",
      weekdays: [1],
      availableTimeEnabled: false,
      availableTime: "invalid",
      deadlineDayOffset: 0,
      deadlineTime: "22:00",
    })[0]).toMatchObject({
      availableLocalDateTime: "2026-08-17T00:00",
      deadlineLocalDateTime: "2026-08-17T22:00",
    });
  });

  it("범위를 각각 켜고 끄며 선택 방향과 전체 자료 순서를 보존한다", () => {
    const units = [1, 2, 3, 4].map((sortIndex) => ({
      id: `day-${sortIndex}`,
      sortIndex,
    }));
    const first = toggleVocabUnitSelection(
      { selectedUnitIds: [] },
      "day-3",
    );
    const second = toggleVocabUnitSelection(first, "day-1");
    expect(
      resolveVocabUnitSelection(units, second).map((unit) => unit.id),
    ).toEqual(["day-3", "day-1"]);
    const third = toggleVocabUnitSelection(second, "day-2");
    expect(
      resolveVocabUnitSelection(units, third).map((unit) => unit.id),
    ).toEqual(["day-3", "day-2", "day-1"]);
    expect(toggleVocabUnitSelection(third, "day-3")).toEqual({
      selectedUnitIds: ["day-1", "day-2"],
    });
    expect(resolveVocabUnitSelection(
      units,
      selectAllVocabUnits(units.map((unit) => unit.id), true),
    ).map((unit) => unit.id)).toEqual([
      "day-1", "day-2", "day-3", "day-4",
    ]);
    expect(resolveVocabUnitSelection(units, {
      selectedUnitIds: ["day-3", "unknown", "day-3", "day-1"],
    }).map((unit) => unit.id)).toEqual(["day-3", "day-1"]);
  });

  it("전체 문항은 실제 가능한 수를 선택 날짜에 균등하게 나눈다", () => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "split",
      questionCount: { mode: "all" },
      baseSessionCount: 2,
      overflowPolicy: "leave",
    })).toMatchObject({
      sessionQuestionCounts: [43, 43],
      selectedQuestionCount: 86,
      remainingQuestionCount: 0,
      issue: null,
    });
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "split",
      questionCount: { mode: "all" },
      baseSessionCount: 3,
      overflowPolicy: "leave",
    }).sessionQuestionCounts).toEqual([29, 29, 28]);
  });

  it("기본 문항 수는 교사 상한을 지키고 방향상 필요할 때만 별도 재분배한다", () => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 10,
      distribution: "split",
      questionCount: { mode: "all" },
      baseSessionCount: 2,
      overflowPolicy: "leave",
    }).sessionQuestionCounts).toEqual([5, 5]);
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "split",
      questionCount: { mode: "all" },
      baseSessionCount: 3,
      overflowPolicy: "leave",
    }).sessionQuestionCounts).toEqual([29, 29, 28]);
    expect(rebalanceHalfRatioSplitQuestionCounts([5, 5], 500)).toEqual([4, 6]);
    expect(rebalanceHalfRatioSplitQuestionCounts([5, 5], 5)).toBeNull();
    expect(rebalanceHalfRatioSplitQuestionCounts([7, 7, 4], 7)).toEqual([
      6, 6, 6,
    ]);
    expect(rebalanceHalfRatioSplitQuestionCounts([7, 7, 6], 7)).toBeNull();
  });

  it("직접 입력은 이번 일정에 남기거나 같은 요일의 다음 주까지 이어서 배정한다", () => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "split",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 2,
      overflowPolicy: "leave",
    })).toMatchObject({
      sessionQuestionCounts: [20, 20],
      selectedQuestionCount: 40,
      remainingQuestionCount: 46,
      extraSessionCount: 0,
    });
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "split",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 2,
      overflowPolicy: "continue_weekly",
    })).toMatchObject({
      sessionQuestionCounts: [20, 20, 20, 20, 6],
      selectedQuestionCount: 86,
      remainingQuestionCount: 0,
      extraSessionCount: 3,
    });
  });

  it.each([
    [81, [20, 20, 20, 17, 4]],
    [82, [20, 20, 20, 18, 4]],
    [83, [20, 20, 20, 19, 4]],
  ])("마지막 %i문항대 총량은 직전 회차와 나눠 최소 4문항을 지킨다", (
    availableQuestionCount,
    expected,
  ) => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount,
      distribution: "split",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 2,
      overflowPolicy: "continue_weekly",
    }).sessionQuestionCounts).toEqual(expected);
  });

  it("선택 날짜를 모두 최소 4문항으로 채울 수 없거나 재분배할 수 없으면 차단한다", () => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 11,
      distribution: "split",
      questionCount: { mode: "all" },
      baseSessionCount: 3,
      overflowPolicy: "leave",
    }).issue).toBe("insufficient_for_selected_dates");
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 5,
      distribution: "split",
      questionCount: { mode: "manual", value: 4 },
      baseSessionCount: 1,
      overflowPolicy: "continue_weekly",
    }).issue).toBe("insufficient_for_selected_dates");
  });

  it("직접 입력 수만큼 앞 회차부터 채우고 마지막 1~3개는 최소 4문항으로 재분배한다", () => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 30,
      distribution: "split",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 2,
      overflowPolicy: "leave",
    }).sessionQuestionCounts).toEqual([20, 10]);
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 21,
      distribution: "split",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 2,
      overflowPolicy: "leave",
    }).sessionQuestionCounts).toEqual([17, 4]);
  });

  it("전체 반복은 회차당 전체 또는 지정 문항 수와 회차당 제외 수를 구분한다", () => {
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "repeat",
      questionCount: { mode: "all" },
      baseSessionCount: 3,
      overflowPolicy: "leave",
    })).toMatchObject({
      sessionQuestionCounts: [86, 86, 86],
      selectedQuestionCount: 86,
      remainingQuestionCount: 0,
    });
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 86,
      distribution: "repeat",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 3,
      overflowPolicy: "leave",
    })).toMatchObject({
      sessionQuestionCounts: [20, 20, 20],
      selectedQuestionCount: 20,
      remainingQuestionCount: 66,
    });
    expect(resolveVocabQuestionAllocation({
      availableQuestionCount: 10,
      distribution: "repeat",
      questionCount: { mode: "manual", value: 20 },
      baseSessionCount: 1,
      overflowPolicy: "leave",
    }).issue).toBe("question_count_exceeds_capacity");
  });

  it("500개가 넘는 무작위 후보 풀도 마지막 준비 묶음을 최소 4문항으로 보존한다", () => {
    expect(splitVocabTargetPoolPreparationCounts(500)).toEqual([500]);
    expect(splitVocabTargetPoolPreparationCounts(500, 463)).toEqual([463, 37]);
    expect(splitVocabTargetPoolPreparationCounts(501)).toEqual([497, 4]);
    expect(splitVocabTargetPoolPreparationCounts(1001)).toEqual([
      500,
      497,
      4,
    ]);
  });

  it("전체 후보 수와 한 회차 실제 상한을 나눠 회차를 계획한다", () => {
    expect(resolveVocabQuestionCapacityScope({
      distribution: "split",
      maximumQuestionCount: 463,
      seriesMaximumQuestionCount: 500,
    })).toEqual({
      availableQuestionCount: 500,
      maximumSessionQuestionCount: 463,
    });
    expect(resolveVocabQuestionCapacityScope({
      distribution: "repeat",
      maximumQuestionCount: 463,
      seriesMaximumQuestionCount: 500,
    })).toEqual({
      availableQuestionCount: 463,
      maximumSessionQuestionCount: 463,
    });

    expect(resolveVocabQuestionCycleAllocation({
      availableQuestionCount: 500,
      distribution: "split",
      questionCount: { mode: "all" },
      selectedDateCount: 2,
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
      maximumSessionQuestionCount: 463,
    })).toMatchObject({
      baseSessionQuestionCounts: [463, 37],
      defaultSessionCount: 2,
      sessionQuestionCounts: [463, 37],
      selectedQuestionCount: 500,
      remainingQuestionCount: 0,
      issue: null,
    });
  });

  it("직접 입력한 회차당 문항 수가 실제 한 회차 상한을 넘으면 막는다", () => {
    expect(resolveVocabQuestionCycleAllocation({
      availableQuestionCount: 500,
      distribution: "split",
      questionCount: { mode: "manual", value: 500 },
      selectedDateCount: 2,
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
      maximumSessionQuestionCount: 463,
    }).issue).toBe("question_count_exceeds_capacity");
  });

  it("가능한 범위까지만은 선택한 날짜 안에서만 문항을 배정한다", () => {
    expect(resolveVocabQuestionCycleAllocation({
      availableQuestionCount: 80,
      distribution: "split",
      questionCount: { mode: "manual", value: 45 },
      selectedDateCount: 1,
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      baseSessionQuestionCounts: [45, 35],
      defaultSessionCount: 2,
      sessionQuestionCounts: [45],
      requiresExtraDateDecision: false,
      scheduledQuestionCount: 45,
      remainingQuestionCount: 35,
      sessionCycleIndexes: [0],
    });
  });

  it("같은 요일로 이어서는 남은 문항이 끝날 때까지 회차를 연장한다", () => {
    expect(resolveVocabQuestionCycleAllocation({
      availableQuestionCount: 80,
      distribution: "split",
      questionCount: { mode: "manual", value: 45 },
      selectedDateCount: 1,
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      baseSessionQuestionCounts: [45, 35],
      defaultSessionCount: 2,
      sessionQuestionCounts: [45, 35],
      scheduledQuestionCount: 80,
      remainingQuestionCount: 0,
      sessionCycleIndexes: [0, 0],
    });
  });

  it("기본 회차보다 날짜가 많을 때만 범위 반복 결정을 요구한다", () => {
    const common = {
      availableQuestionCount: 80,
      distribution: "split" as const,
      questionCount: { mode: "manual" as const, value: 45 },
      selectedDateCount: 3,
      overflowPolicy: "leave" as const,
    };
    expect(resolveVocabQuestionCycleAllocation({
      ...common,
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      sessionQuestionCounts: [45, 35],
      requiresExtraDateDecision: true,
    });
    expect(resolveVocabQuestionCycleAllocation({
      ...common,
      extraDatePolicy: "repeat_from_start",
    })).toMatchObject({
      sessionQuestionCounts: [45, 35, 45],
      requiresExtraDateDecision: false,
      scheduledQuestionCount: 125,
      sessionCycleIndexes: [0, 0, 1],
    });
  });

  it.each([
    [45, [45]],
    [46, [42, 4]],
    [80, [45, 35]],
    [90, [45, 45]],
    [91, [45, 42, 4]],
    [92, [45, 43, 4]],
    [93, [45, 44, 4]],
  ])("직접 입력 45문항의 총 %i개 경계를 안전하게 나눈다", (
    availableQuestionCount,
    expected,
  ) => {
    expect(resolveVocabQuestionCycleAllocation({
      availableQuestionCount,
      distribution: "split",
      questionCount: { mode: "manual", value: 45 },
      selectedDateCount: 1,
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
    }).sessionQuestionCounts).toEqual(expected);
  });

  it("전체 반복은 선택한 날짜마다 같은 문항 수를 배정하고 추가 확인하지 않는다", () => {
    expect(resolveVocabQuestionCycleAllocation({
      availableQuestionCount: 80,
      distribution: "repeat",
      questionCount: { mode: "manual", value: 45 },
      selectedDateCount: 3,
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
    })).toMatchObject({
      sessionQuestionCounts: [45, 45, 45],
      defaultSessionCount: 1,
      requiresExtraDateDecision: false,
      scheduledQuestionCount: 135,
    });
  });

  it("같은 요일 시간표를 다음 주 실제 날짜로 반복한다", () => {
    const base = buildScheduleSlots({
      startDate: "2026-08-21",
      weekdays: [1, 3, 5],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    });
    expect(extendScheduleSlots(base, 5).map((slot) => slot.date)).toEqual([
      "2026-08-21",
      "2026-08-24",
      "2026-08-26",
      "2026-08-28",
      "2026-08-31",
    ]);
    expect(extendScheduleSlots(base, 5).at(-1)).toMatchObject({
      availableLocalDateTime: "2026-08-31T16:00",
      deadlineLocalDateTime: "2026-09-01T22:00",
    });
  });

  it("첫 주 수요일만 옮겨도 연장 회차는 원래 월수금 규칙을 따른다", () => {
    const recurrence = buildScheduleSlots({
      startDate: "2026-08-21",
      weekdays: [1, 3, 5],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    });
    const overridden = applyScheduleSlotOverride(recurrence, 2, {
      availableLocalDateTime: "2026-08-25T16:00",
      deadlineLocalDateTime: "2026-08-26T22:00",
    });

    expect(
      extendScheduleSlotsFromRecurrence(overridden, recurrence, 5)
        .map((slot) => slot.date),
    ).toEqual([
      "2026-08-21",
      "2026-08-25",
      "2026-08-26",
      "2026-08-28",
      "2026-08-31",
    ]);
  });

  it("범위순 나누기는 중복 없이 이어지고 무작위는 seed에 따라 재현된다", () => {
    const candidateIds = Array.from({ length: 12 }, (_, index) => index + 1);
    expect(planVocabSeriesTargetIds({
      candidateIds,
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [4, 4, 4],
      seedScope: "plan-a:student-a",
    })).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
    const first = planVocabSeriesTargetIds({
      candidateIds,
      distribution: "split",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4, 4],
      seedScope: "plan-a:student-a",
    });
    expect(planVocabSeriesTargetIds({
      candidateIds,
      distribution: "split",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4, 4],
      seedScope: "plan-a:student-a",
    })).toEqual(first);
    expect(new Set(first.flat())).toHaveLength(12);
    expect(planVocabSeriesTargetIds({
      candidateIds,
      distribution: "split",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4, 4],
      seedScope: "plan-b:student-a",
    })).not.toEqual(first);
  });

  it("무작위 전체 반복은 후보를 다 쓰기 전까지 중복을 최소화한다", () => {
    const sessions = planVocabSeriesTargetIds({
      candidateIds: Array.from({ length: 10 }, (_, index) => index + 1),
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [6, 6],
      seedScope: "plan-a:student-a",
    });
    expect(new Set(sessions[0])).toHaveLength(6);
    expect(new Set(sessions[1])).toHaveLength(6);
    expect(sessions[0]?.filter((id) => sessions[1]?.includes(id))).toHaveLength(2);
    expect(new Set(sessions.flat())).toHaveLength(10);
  });

  it("나누기는 양방향 단어를 전 회차 기준으로 배치해 뒤 회차 고갈을 막는다", () => {
    const candidates = [
      { id: 1, eligibleDirections: ["english_to_korean", "korean_to_english"] },
      { id: 2, eligibleDirections: ["english_to_korean", "korean_to_english"] },
      { id: 3, eligibleDirections: ["english_to_korean"] },
      { id: 4, eligibleDirections: ["english_to_korean"] },
      { id: 5, eligibleDirections: ["korean_to_english"] },
      { id: 6, eligibleDirections: ["korean_to_english"] },
      { id: 7, eligibleDirections: ["korean_to_english"] },
      { id: 8, eligibleDirections: ["korean_to_english"] },
    ] as const;
    const sessions = planDirectionalVocabSeriesTargetIds({
      candidates,
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 50,
      seedScope: "plan-a:student-a",
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.length === 4)).toBe(true);
    expect(new Set(sessions.flat())).toHaveLength(8);
    expect(sessions[0]).toEqual([1, 2, 5, 6]);
    expect(sessions[1]).toEqual([3, 4, 7, 8]);
  });

  it("같은 철자의 다른 sense는 영→한 나누기에서 서로 다른 회차에 둔다", () => {
    const candidates = [
      {
        id: 1,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: { promptKey: "observe", answerKey: "관찰하다" },
        },
      },
      {
        id: 2,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: { promptKey: "observe", answerKey: "엄수하다" },
        },
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 3,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: {
            promptKey: `word-${index}`,
            answerKey: `뜻-${index}`,
          },
        },
      })),
    ];
    const sessions = planDirectionalVocabSeriesTargets({
      candidates,
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 100,
      seedScope: "sense-series",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(8);
    expect(sessions.some((session) =>
      session.some((target) => target.id === 1) &&
      session.some((target) => target.id === 2)
    )).toBe(false);
    expect(sessions.flat().every(
      (target) => target.direction === "english_to_korean",
    )).toBe(true);
  });

  it("충돌 sense가 범위 끝에 있어도 앞 회차 문항을 옮겨 전체를 나눈다", () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: {
            promptKey: `unique-${index}`,
            answerKey: `고유-${index}`,
          },
        },
      })),
      {
        id: 7,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: { promptKey: "observe", answerKey: "관찰하다" },
        },
      },
      {
        id: 8,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: { promptKey: "observe", answerKey: "엄수하다" },
        },
      },
    ];
    const sessions = planDirectionalVocabSeriesTargets({
      candidates,
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 100,
      seedScope: "late-sense-conflict",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(8);
    expect(sessions.some((session) =>
      session.some((target) => target.id === 7) &&
      session.some((target) => target.id === 8)
    )).toBe(false);
  });

  it("충돌 후보가 있어도 무작위 반복은 가능한 모든 후보를 먼저 한 번씩 쓴다", () => {
    const candidates = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: {
            promptKey: `repeat-unique-${index}`,
            answerKey: `반복 고유-${index}`,
          },
        },
      })),
      {
        id: 7,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: { promptKey: "observe", answerKey: "관찰하다" },
        },
      },
      {
        id: 8,
        eligibleDirections: ["english_to_korean" as const],
        conflictKeys: {
          english_to_korean: { promptKey: "observe", answerKey: "엄수하다" },
        },
      },
    ];
    const sessions = planDirectionalVocabSeriesTargets({
      candidates,
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 100,
      seedScope: "seed8",
    });
    expect(sessions.map((session) => new Set(
      session.map((target) => target.id),
    ).size)).toEqual([4, 4]);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(8);
  });

  it("빈자리가 있어도 충돌하는 기존 뜻을 옮겨 반복 회차를 완성한다", () => {
    const sessions = planDirectionalVocabSeriesTargets({
      candidates: [
        { id: 1, eligibleDirections: ["english_to_korean"], conflictKeys: { english_to_korean: { promptKey: "p", answerKey: "a" } } },
        { id: 2, eligibleDirections: ["english_to_korean"], conflictKeys: { english_to_korean: { promptKey: "p", answerKey: "a" } } },
        { id: 3, eligibleDirections: ["english_to_korean"], conflictKeys: { english_to_korean: { promptKey: "p", answerKey: "b" } } },
        { id: 4, eligibleDirections: ["english_to_korean"], conflictKeys: { english_to_korean: { promptKey: "q", answerKey: "c" } } },
        { id: 5, eligibleDirections: ["english_to_korean"], conflictKeys: { english_to_korean: { promptKey: "r", answerKey: "d" } } },
        ...Array.from({ length: 12 }, (_, index) => ({
          id: index + 6,
          eligibleDirections: ["korean_to_english" as const],
          conflictKeys: {
            korean_to_english: {
              promptKey: `unused-k-${index}`,
              answerKey: `unused-a-${index}`,
            },
          },
        })),
      ],
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 100,
      seedScope: "q0",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(sessions.every((session) =>
      [1, 2, 4, 5].every((id) =>
        session.some((target) => target.id === id)
      )
    )).toBe(true);
  });

  it("같은 제시어의 불가능한 뜻 후보가 많아도 가능한 뜻 묶음을 고른다", () => {
    const direction = "english_to_korean" as const;
    const sessions = planDirectionalVocabSeriesTargets({
      candidates: [
        ...[1, 2].map((id) => ({
          id,
          eligibleDirections: [direction],
          conflictKeys: { [direction]: { promptKey: "p", answerKey: "a" } },
        })),
        ...Array.from({ length: 13 }, (_, index) => ({
          id: index + 3,
          eligibleDirections: [direction],
          conflictKeys: {
            [direction]: { promptKey: "p", answerKey: `b-${index}` },
          },
        })),
        { id: 16, eligibleDirections: [direction], conflictKeys: { [direction]: { promptKey: "u16", answerKey: "x16" } } },
        { id: 17, eligibleDirections: [direction], conflictKeys: { [direction]: { promptKey: "u17", answerKey: "x17" } } },
      ],
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 100,
      seedScope: "z0",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(sessions.every((session) =>
      new Set(session.map((target) => target.id)).size === 4
    )).toBe(true);
  });

  it("50% 반복에서 여러 교환이 필요해도 가능한 후보를 모두 한 번씩 쓴다", () => {
    const candidates = [
      { id: 1, eligibleDirections: ["korean_to_english" as const], conflictKeys: { english_to_korean: { promptKey: "e2", answerKey: "a2" }, korean_to_english: { promptKey: "k3", answerKey: "b1" } } },
      { id: 2, eligibleDirections: ["english_to_korean" as const], conflictKeys: { english_to_korean: { promptKey: "e3", answerKey: "a1" }, korean_to_english: { promptKey: "k0", answerKey: "b2" } } },
      { id: 3, eligibleDirections: ["english_to_korean" as const, "korean_to_english" as const], conflictKeys: { english_to_korean: { promptKey: "e1", answerKey: "a2" }, korean_to_english: { promptKey: "k3", answerKey: "b1" } } },
      { id: 4, eligibleDirections: ["english_to_korean" as const, "korean_to_english" as const], conflictKeys: { english_to_korean: { promptKey: "e2", answerKey: "a0" }, korean_to_english: { promptKey: "k0", answerKey: "b0" } } },
      { id: 5, eligibleDirections: ["english_to_korean" as const, "korean_to_english" as const], conflictKeys: { english_to_korean: { promptKey: "e0", answerKey: "a2" }, korean_to_english: { promptKey: "k0", answerKey: "b2" } } },
      { id: 6, eligibleDirections: ["english_to_korean" as const], conflictKeys: { english_to_korean: { promptKey: "e0", answerKey: "a1" }, korean_to_english: { promptKey: "k1", answerKey: "b1" } } },
      { id: 7, eligibleDirections: ["english_to_korean" as const, "korean_to_english" as const], conflictKeys: { english_to_korean: { promptKey: "e0", answerKey: "a2" }, korean_to_english: { promptKey: "k3", answerKey: "b0" } } },
      { id: 8, eligibleDirections: ["english_to_korean" as const], conflictKeys: { english_to_korean: { promptKey: "e0", answerKey: "a0" }, korean_to_english: { promptKey: "k3", answerKey: "b0" } } },
    ];
    const sessions = planDirectionalVocabSeriesTargets({
      candidates,
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 50,
      seedScope: "u1345",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(8);
  });

  it("긴 반복 일정도 회차 조합을 재사용해 가능한 모든 후보를 순환한다", () => {
    const english = "english_to_korean" as const;
    const korean = "korean_to_english" as const;
    const sessions = planDirectionalVocabSeriesTargets({
      candidates: [
        { id: 1, eligibleDirections: [english], conflictKeys: { [english]: { promptKey: "e2", answerKey: "a0" } } },
        { id: 2, eligibleDirections: [english], conflictKeys: { [english]: { promptKey: "e0", answerKey: "a1" } } },
        { id: 3, eligibleDirections: [korean], conflictKeys: { [korean]: { promptKey: "k2", answerKey: "b0" } } },
        { id: 4, eligibleDirections: [english, korean], conflictKeys: { [english]: { promptKey: "e1", answerKey: "a1" }, [korean]: { promptKey: "k1", answerKey: "b1" } } },
        { id: 5, eligibleDirections: [korean], conflictKeys: { [korean]: { promptKey: "k2", answerKey: "b2" } } },
      ],
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: Array.from({ length: 13 }, () => 4),
      englishToKoreanRatio: 50,
      seedScope: "m136",
    });
    expect(sessions).toHaveLength(13);
    expect(sessions.every((session) => session.length === 4)).toBe(true);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(5);
  });

  it("50% 혼합 충돌은 같은 제시어·같은 답을 허용하며 회차 간 증강 배치한다", () => {
    const candidates = [
      { id: 1, eligibleDirections: ["english_to_korean" as const], conflictKeys: { english_to_korean: { promptKey: "ep3", answerKey: "ea1" } } },
      { id: 2, eligibleDirections: ["korean_to_english" as const], conflictKeys: { korean_to_english: { promptKey: "kp1", answerKey: "ka0" } } },
      { id: 3, eligibleDirections: ["korean_to_english" as const], conflictKeys: { korean_to_english: { promptKey: "kp1", answerKey: "ka2" } } },
      { id: 4, eligibleDirections: ["english_to_korean" as const], conflictKeys: { english_to_korean: { promptKey: "ep3", answerKey: "ea2" } } },
      { id: 5, eligibleDirections: ["korean_to_english" as const], conflictKeys: { korean_to_english: { promptKey: "kp2", answerKey: "ka2" } } },
      { id: 6, eligibleDirections: ["korean_to_english" as const], conflictKeys: { korean_to_english: { promptKey: "kp1", answerKey: "ka0" } } },
      { id: 7, eligibleDirections: ["english_to_korean" as const], conflictKeys: { english_to_korean: { promptKey: "ep1", answerKey: "ea1" } } },
      { id: 8, eligibleDirections: ["english_to_korean" as const, "korean_to_english" as const], conflictKeys: { english_to_korean: { promptKey: "ep8", answerKey: "ea8" }, korean_to_english: { promptKey: "kp8", answerKey: "ka8" } } },
    ];
    const sessions = planDirectionalVocabSeriesTargets({
      candidates,
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 50,
      seedScope: "mixed-conflict-augmenting-path",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(8);
    expect(sessions.map((session) =>
      session.filter((target) => target.direction === "english_to_korean").length
    )).toEqual([2, 2]);
  });

  it("같은 한국어 뜻의 다른 표제어는 한→영 나누기에서 서로 다른 회차에 둔다", () => {
    const candidates = [
      {
        id: 1,
        eligibleDirections: ["korean_to_english" as const],
        conflictKeys: {
          korean_to_english: { promptKey: "보다", answerKey: "watch" },
        },
      },
      {
        id: 2,
        eligibleDirections: ["korean_to_english" as const],
        conflictKeys: {
          korean_to_english: { promptKey: "보다", answerKey: "see" },
        },
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: index + 3,
        eligibleDirections: ["korean_to_english" as const],
        conflictKeys: {
          korean_to_english: {
            promptKey: `뜻-${index}`,
            answerKey: `word-${index}`,
          },
        },
      })),
    ];
    const sessions = planDirectionalVocabSeriesTargets({
      candidates,
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [4, 4],
      englishToKoreanRatio: 0,
      seedScope: "korean-conflict-series",
    });
    expect(sessions.map((session) => session.length)).toEqual([4, 4]);
    expect(new Set(sessions.flatMap((session) =>
      session.map((target) => target.id)
    ))).toHaveLength(8);
    expect(sessions.some((session) =>
      session.some((target) => target.id === 1) &&
      session.some((target) => target.id === 2)
    )).toBe(false);
  });

  it("50% 무작위 반복은 방향별 풀이 고갈될 때만 최소 한 단어를 다시 쓴다", () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        eligibleDirections: ["english_to_korean" as const],
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: index + 6,
        eligibleDirections: ["korean_to_english" as const],
      })),
    ];
    const plan = (seedScope: string) => planDirectionalVocabSeriesTargetIds({
      candidates,
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [5, 5],
      englishToKoreanRatio: 50,
      seedScope,
    });
    const sessions = plan("plan-a:student-a");
    expect(sessions.every((session) => session.length === 5)).toBe(true);
    expect(sessions.every((session) => new Set(session).size === 5)).toBe(true);
    expect(sessions[0]?.filter((id) => sessions[1]?.includes(id))).toHaveLength(1);
    expect(new Set(sessions.flat())).toHaveLength(9);
    expect(plan("plan-a:student-a")).toEqual(sessions);
    expect(plan("plan-b:student-a")).not.toEqual(sessions);
  });

  it("방향별 후보가 충분한 홀수 회차 반복은 단일시험 비율에 묶이지 않고 모두 새 단어를 쓴다", () => {
    const sessions = planDirectionalVocabSeriesTargetIds({
      candidates: [
        ...Array.from({ length: 10 }, (_, index) => ({
          id: index + 1,
          eligibleDirections: ["english_to_korean" as const],
        })),
        ...Array.from({ length: 10 }, (_, index) => ({
          id: index + 11,
          eligibleDirections: ["korean_to_english" as const],
        })),
      ],
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [5, 5],
      englishToKoreanRatio: 50,
      seedScope: "plan-a:student-a",
    });
    expect(new Set(sessions.flat())).toHaveLength(10);
    expect(sessions[0]?.filter((id) => sessions[1]?.includes(id))).toHaveLength(0);
  });

  it("직접 입력 5문항 상한 안에서 6E+4K를 골라 5문항 두 회차를 유지한다", () => {
    const sessions = planDirectionalVocabSeriesTargetIds({
      candidates: [
        ...Array.from({ length: 6 }, (_, index) => ({
          id: index + 1,
          eligibleDirections: ["english_to_korean" as const],
        })),
        ...Array.from({ length: 6 }, (_, index) => ({
          id: index + 7,
          eligibleDirections: ["korean_to_english" as const],
        })),
      ],
      distribution: "split",
      selectionMode: "source_order",
      sessionQuestionCounts: [5, 5],
      englishToKoreanRatio: 50,
      seedScope: "plan-a:student-a",
    });
    expect(sessions.map((session) => session.length)).toEqual([5, 5]);
    expect(new Set(sessions.flat())).toHaveLength(10);
  });

  it("양방향 단어가 충분하면 홀수 회차 반복도 중복 없이 방향을 바꿔 쓴다", () => {
    const sessions = planDirectionalVocabSeriesTargetIds({
      candidates: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        eligibleDirections: [
          "english_to_korean" as const,
          "korean_to_english" as const,
        ],
      })),
      distribution: "repeat",
      selectionMode: "random",
      sessionQuestionCounts: [5, 5],
      englishToKoreanRatio: 50,
      seedScope: "plan-a:student-a",
    });
    expect(new Set(sessions.flat())).toHaveLength(10);
  });

  it("작은 E/K/양방향 조합 전수에서 가능한 split을 놓치지 않는다", () => {
    for (let english = 0; english <= 5; english += 1) {
      for (let korean = 0; korean <= 5; korean += 1) {
        for (let both = 0; both <= 5; both += 1) {
          const candidates = [
            ...Array.from({ length: english }, (_, index) => ({
              id: index + 1,
              eligibleDirections: ["english_to_korean" as const],
            })),
            ...Array.from({ length: korean }, (_, index) => ({
              id: english + index + 1,
              eligibleDirections: ["korean_to_english" as const],
            })),
            ...Array.from({ length: both }, (_, index) => ({
              id: english + korean + index + 1,
              eligibleDirections: [
                "english_to_korean" as const,
                "korean_to_english" as const,
              ],
            })),
          ];
          const directionById = new Map(candidates.map((candidate) => [
            candidate.id,
            candidate.eligibleDirections.length === 2
              ? "both" as const
              : candidate.eligibleDirections[0] === "english_to_korean"
                ? "english" as const
                : "korean" as const,
          ]));
          for (const counts of [[4, 4], [4, 5], [5, 5]] as const) {
            const total = counts[0] + counts[1];
            const neededEnglish = Math.round(counts[0] / 2) +
              Math.round(counts[1] / 2);
            let expectedFeasible = false;
            for (let selectedEnglish = 0; selectedEnglish <= english; selectedEnglish += 1) {
              for (let selectedKorean = 0; selectedKorean <= korean; selectedKorean += 1) {
                const selectedBoth = total - selectedEnglish - selectedKorean;
                const bothForEnglish = neededEnglish - selectedEnglish;
                if (
                  selectedBoth >= 0 &&
                  selectedBoth <= both &&
                  bothForEnglish >= 0 &&
                  bothForEnglish <= selectedBoth &&
                  total - neededEnglish - selectedKorean ===
                    selectedBoth - bothForEnglish
                ) {
                  expectedFeasible = true;
                }
              }
            }
            const sessions = planDirectionalVocabSeriesTargetIds({
              candidates,
              distribution: "split",
              selectionMode: "source_order",
              sessionQuestionCounts: counts,
              englishToKoreanRatio: 50,
              seedScope: "exhaustive-split",
            });
            expect(sessions.length === 2).toBe(expectedFeasible);
            if (sessions.length === 2) {
              expect(new Set(sessions.flat())).toHaveLength(total);
              expect(targetSetCanMeetEnglishCount(
                sessions[0]!,
                Math.round(counts[0] / 2),
                directionById,
              )).toBe(true);
              expect(targetSetCanMeetEnglishCount(
                sessions[1]!,
                Math.round(counts[1] / 2),
                directionById,
              )).toBe(true);
            }
          }
        }
      }
    }
  });

  it("시간 템플릿 적용과 회차 수정이 원본 템플릿을 바꾸지 않는다", () => {
    const template = {
      id: "after-class",
      label: "수업 후",
      availableTime: "18:00",
      deadlineDayOffset: 1,
      deadlineTime: "14:00",
      timing: { mode: "per_question", perQuestionSeconds: 20 } as const,
    };
    const applied = applyTimeTemplate({
      schedule: {
        startDate: "2026-08-17",
        weekdays: [1, 3, 5] as const,
        availableTime: "00:00",
        deadlineDayOffset: 0,
        deadlineTime: "23:59",
      },
      exam,
    }, template);
    const slots = buildScheduleSlots(applied.schedule);
    applied.schedule.availableTime = "19:00";
    expect(template.availableTime).toBe("18:00");
    expect(applied.exam.timing).toEqual({
      mode: "per_question",
      perQuestionSeconds: 20,
    });
    const changed = applyScheduleSlotOverride(slots, 1, {
      availableLocalDateTime: "2026-08-18T20:00",
      deadlineLocalDateTime: "2026-08-19T21:00",
    });
    expect(changed[0]?.availableLocalDateTime).toBe("2026-08-18T20:00");
    expect(changed[0]?.deadlineLocalDateTime).toBe("2026-08-19T21:00");
    expect(changed[0]?.date).toBe("2026-08-18");
    expect(changed[1]).toEqual(slots[1]);
    expect(slots[0]?.availableLocalDateTime).toBe("2026-08-17T18:00");
    expect(template.availableTime).toBe("18:00");
  });

  it("최근 시험 복사는 시험 조건만 바꾸고 대상과 날짜와 범위는 유지한다", () => {
    const draft = {
      studentIds: ["student-new"],
      date: "2026-08-21",
      unitIds: ["day-new"],
      exam,
    };
    const copied = copyPreviousExamConditions(draft, {
      directionRatio: 100,
      passingScore: 90,
      questionOrderMode: "ascending",
      timing: { mode: "total", totalSeconds: 600 },
    });
    expect(copied.studentIds).toEqual(["student-new"]);
    expect(copied.date).toBe("2026-08-21");
    expect(copied.unitIds).toEqual(["day-new"]);
    expect(copied.exam.passingScore).toBe(90);
  });

});
