import type { AssignmentDatasetItem } from "../catalog-types";
import {
  clearVocabCollisionDecisionFrom,
  setVocabCollisionDecision,
  type VocabCollisionDecisionRecord,
} from "../domain/vocab-collision-decisions";
import {
  advanceDayRangeSelection,
  selectInitialVocabDatasetId,
  toggleWeekday,
  type DayRangeSelection,
  type IsoWeekday,
  type VocabQuestionCountChoice,
  type VocabExtraDatePolicy,
  type VocabRangeDistribution,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabSplitBasis,
  type VocabSplitOverflowPolicy,
  type VocabTargetSelectionMode,
  type VocabUnitAllocationMode,
  type VocabWeekdayUnitCounts,
} from "../domain/vocab-assignment-plan";

export type VocabPlannerState = {
  datasetId: string;
  range: DayRangeSelection;
  distribution: VocabRangeDistribution;
  splitBasis: VocabSplitBasis;
  unitAllocationMode: VocabUnitAllocationMode;
  unitsPerSession: number;
  weekdayUnitsPerSession: VocabWeekdayUnitCounts;
  questionCountMode: VocabQuestionCountChoice["mode"];
  manualQuestionCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  extraDatePolicy: VocabExtraDatePolicy;
  selectionMode: VocabTargetSelectionMode;
  planNonce: string;
  schedule: VocabScheduleDraft;
  sessionScheduleOverrides: Readonly<
    Record<number, VocabScheduleSlotOverride>
  >;
  collisionDecisionRecords: readonly VocabCollisionDecisionRecord[];
};

export type VocabPlannerAction =
  | { type: "dataset"; value: string }
  | { type: "range"; unitId: string }
  | { type: "distribution"; value: VocabRangeDistribution }
  | { type: "split_basis"; value: VocabSplitBasis }
  | { type: "unit_allocation_mode"; value: VocabUnitAllocationMode }
  | { type: "units_per_session"; value: number }
  | { type: "weekday_units_per_session"; weekday: IsoWeekday; value: number }
  | { type: "question_count_mode"; value: VocabQuestionCountChoice["mode"] }
  | { type: "manual_question_count"; value: number }
  | { type: "overflow_policy"; value: VocabSplitOverflowPolicy }
  | { type: "extra_date_policy"; value: VocabExtraDatePolicy }
  | { type: "selection_mode"; value: VocabTargetSelectionMode }
  | { type: "schedule/update"; patch: Partial<VocabScheduleDraft> }
  | { type: "schedule/replace"; value: VocabScheduleDraft }
  | { type: "schedule/toggle_weekday"; weekday: IsoWeekday }
  | {
      type: "session_schedule";
      sessionNumber: number;
      value: VocabScheduleSlotOverride;
    }
  | { type: "decision/set"; value: VocabCollisionDecisionRecord }
  | { type: "decision/clear_from"; collisionId: string };

export function vocabPlannerReducer(
  state: VocabPlannerState,
  action: VocabPlannerAction,
): VocabPlannerState {
  switch (action.type) {
    case "dataset":
      return {
        ...state,
        datasetId: action.value,
        range: { startUnitId: null, endUnitId: null },
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "range":
      return {
        ...state,
        range: advanceDayRangeSelection(state.range, action.unitId),
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "distribution":
      return {
        ...state,
        distribution: action.value,
        overflowPolicy: action.value === "split"
          ? state.overflowPolicy
          : "leave",
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "split_basis":
      return {
        ...state,
        splitBasis: action.value,
        overflowPolicy: action.value === "range_unit" ||
            state.questionCountMode !== "manual"
          ? "leave"
          : state.overflowPolicy,
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "unit_allocation_mode":
      return {
        ...state,
        unitAllocationMode: action.value,
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "units_per_session":
      return {
        ...state,
        unitsPerSession: action.value,
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "weekday_units_per_session":
      return {
        ...state,
        weekdayUnitsPerSession: {
          ...state.weekdayUnitsPerSession,
          [action.weekday]: action.value,
        },
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "question_count_mode":
      return {
        ...state,
        questionCountMode: action.value,
        overflowPolicy:
          state.distribution === "split" &&
              (action.value === "manual" || state.splitBasis === "range_unit")
            ? state.overflowPolicy
            : "leave",
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "manual_question_count":
      return {
        ...state,
        manualQuestionCount: action.value,
        extraDatePolicy: "unconfirmed",
        collisionDecisionRecords: [],
      };
    case "overflow_policy":
      return {
        ...state,
        overflowPolicy: action.value,
        collisionDecisionRecords: [],
      };
    case "extra_date_policy":
      return {
        ...state,
        extraDatePolicy: action.value,
        collisionDecisionRecords: [],
      };
    case "selection_mode":
      return {
        ...state,
        selectionMode: action.value,
        collisionDecisionRecords: [],
      };
    case "schedule/update":
      return {
        ...state,
        schedule: { ...state.schedule, ...action.patch },
        extraDatePolicy: action.patch.weekdays !== undefined
          ? "unconfirmed"
          : state.extraDatePolicy,
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "schedule/replace": {
      const weekdaysChanged =
        state.schedule.weekdays.length !== action.value.weekdays.length ||
        state.schedule.weekdays.some(
          (weekday, index) => weekday !== action.value.weekdays[index],
        );
      return {
        ...state,
        schedule: action.value,
        extraDatePolicy: weekdaysChanged
          ? "unconfirmed"
          : state.extraDatePolicy,
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    }
    case "schedule/toggle_weekday":
      return {
        ...state,
        schedule: {
          ...state.schedule,
          weekdays: toggleWeekday(state.schedule.weekdays, action.weekday),
        },
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "session_schedule":
      return {
        ...state,
        sessionScheduleOverrides: {
          ...state.sessionScheduleOverrides,
          [action.sessionNumber]: { ...action.value },
        },
        collisionDecisionRecords: [],
      };
    case "decision/set":
      return {
        ...state,
        collisionDecisionRecords: setVocabCollisionDecision(
          state.collisionDecisionRecords,
          action.value,
        ),
      };
    case "decision/clear_from":
      return {
        ...state,
        collisionDecisionRecords: clearVocabCollisionDecisionFrom(
          state.collisionDecisionRecords,
          action.collisionId,
        ),
      };
  }
}

export function createInitialVocabPlannerState(
  datasets: readonly AssignmentDatasetItem[],
  initialDatasetId: string,
  today: string,
): VocabPlannerState {
  const datasetId = selectInitialVocabDatasetId(datasets, initialDatasetId);
  return {
    datasetId,
    range: { startUnitId: null, endUnitId: null },
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
    questionCountMode: "all",
    manualQuestionCount: 20,
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectionMode: "source_order",
    planNonce: crypto.randomUUID(),
    schedule: {
      startDate: today,
      weekdays: [],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    },
    sessionScheduleOverrides: {},
    collisionDecisionRecords: [],
  };
}
