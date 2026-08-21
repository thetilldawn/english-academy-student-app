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
  type VocabRangeDistribution,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabSplitOverflowPolicy,
  type VocabTargetSelectionMode,
} from "../domain/vocab-assignment-plan";

export type VocabPlannerState = {
  datasetId: string;
  range: DayRangeSelection;
  distribution: VocabRangeDistribution;
  questionCountMode: VocabQuestionCountChoice["mode"];
  manualQuestionCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
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
  | { type: "question_count_mode"; value: VocabQuestionCountChoice["mode"] }
  | { type: "manual_question_count"; value: number }
  | { type: "overflow_policy"; value: VocabSplitOverflowPolicy }
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
        collisionDecisionRecords: [],
      };
    case "range":
      return {
        ...state,
        range: advanceDayRangeSelection(state.range, action.unitId),
        collisionDecisionRecords: [],
      };
    case "distribution":
      return {
        ...state,
        distribution: action.value,
        overflowPolicy: action.value === "split"
          ? state.overflowPolicy
          : "leave",
        collisionDecisionRecords: [],
      };
    case "question_count_mode":
      return {
        ...state,
        questionCountMode: action.value,
        overflowPolicy:
          action.value === "manual" && state.distribution === "split"
            ? state.overflowPolicy
            : "leave",
        collisionDecisionRecords: [],
      };
    case "manual_question_count":
      return {
        ...state,
        manualQuestionCount: action.value,
        collisionDecisionRecords: [],
      };
    case "overflow_policy":
      return {
        ...state,
        overflowPolicy: action.value,
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
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "schedule/replace":
      return {
        ...state,
        schedule: action.value,
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "schedule/toggle_weekday":
      return {
        ...state,
        schedule: {
          ...state.schedule,
          weekdays: toggleWeekday(state.schedule.weekdays, action.weekday),
        },
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
    questionCountMode: "all",
    manualQuestionCount: 20,
    overflowPolicy: "leave",
    selectionMode: "source_order",
    planNonce: crypto.randomUUID(),
    schedule: {
      startDate: today,
      weekdays: [1, 3, 5],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    },
    sessionScheduleOverrides: {},
    collisionDecisionRecords: [],
  };
}
