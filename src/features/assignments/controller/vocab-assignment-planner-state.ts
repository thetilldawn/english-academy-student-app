import type { AssignmentDatasetItem } from "../catalog-types";
import {
  clearVocabCollisionDecisionFrom,
  setVocabCollisionDecision,
  type VocabCollisionDecisionRecord,
} from "../domain/vocab-collision-decisions";
import {
  selectAllVocabUnits,
  toggleVocabUnitSelection,
  selectInitialVocabDatasetId,
  toggleWeekday,
  type IsoWeekday,
  type VocabAssignmentMode,
  type VocabUnitSelection,
  type VocabQuestionCountChoice,
  type VocabExtraDatePolicy,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabSplitOverflowPolicy,
  type VocabTargetSelectionMode,
} from "../domain/vocab-assignment-plan";

export type VocabPlannerState = {
  datasetId: string;
  range: VocabUnitSelection;
  assignmentMode: VocabAssignmentMode;
  questionCountMode: VocabQuestionCountChoice["mode"];
  manualQuestionCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  extraDatePolicy: VocabExtraDatePolicy;
  selectionMode: VocabTargetSelectionMode;
  planNonce: string;
  scheduleEnabled?: boolean;
  immediateDate?: string;
  schedule: VocabScheduleDraft;
  sessionScheduleOverrides: Readonly<
    Record<number, VocabScheduleSlotOverride>
  >;
  collisionDecisionRecords: readonly VocabCollisionDecisionRecord[];
};

export type VocabPlannerAction =
  | { type: "dataset"; value: string }
  | { type: "range/toggle"; unitId: string }
  | { type: "range/all"; unitIds: readonly string[]; selectAll: boolean }
  | { type: "assignment_mode"; value: VocabAssignmentMode }
  | { type: "question_count_mode"; value: VocabQuestionCountChoice["mode"] }
  | { type: "manual_question_count"; value: number }
  | { type: "overflow_policy"; value: VocabSplitOverflowPolicy }
  | { type: "extra_date_policy"; value: VocabExtraDatePolicy }
  | { type: "selection_mode"; value: VocabTargetSelectionMode }
  | { type: "schedule/enabled"; enabled: boolean }
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
        range: { selectedUnitIds: [] },
        questionCountMode: "all",
        manualQuestionCount: 0,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "range/toggle":
      return {
        ...state,
        range: toggleVocabUnitSelection(state.range, action.unitId),
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "range/all":
      return {
        ...state,
        range: selectAllVocabUnits(action.unitIds, action.selectAll),
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "assignment_mode":
      return {
        ...state,
        assignmentMode: action.value,
        overflowPolicy: action.value === "all_sessions"
          ? "leave"
          : state.overflowPolicy,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "question_count_mode":
      return {
        ...state,
        questionCountMode: action.value,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "manual_question_count":
      return {
        ...state,
        manualQuestionCount: action.value,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
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
    case "schedule/enabled":
      return {
        ...state,
        scheduleEnabled: action.enabled,
        assignmentMode: action.enabled ? state.assignmentMode : "all_sessions",
        overflowPolicy: action.enabled ? state.overflowPolicy : "leave",
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
        collisionDecisionRecords: [],
      };
    case "schedule/update": {
      const scheduleShapeChanged =
        action.patch.weekdays !== undefined ||
        action.patch.startDate !== undefined;
      return {
        ...state,
        schedule: { ...state.schedule, ...action.patch },
        extraDatePolicy: action.patch.weekdays !== undefined
          ? "unconfirmed"
          : state.extraDatePolicy,
        sessionScheduleOverrides: scheduleShapeChanged
          ? {}
          : state.sessionScheduleOverrides,
        collisionDecisionRecords: [],
      };
    }
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
  currentLocalDateTime = `${today}T00:00`,
): VocabPlannerState {
  const datasetId = selectInitialVocabDatasetId(datasets, initialDatasetId);
  const initialDeadline = resolveInitialVocabDeadline(
    today,
    currentLocalDateTime,
  );
  return {
    datasetId,
    range: { selectedUnitIds: [] },
    assignmentMode: "all_sessions",
    questionCountMode: "all",
    manualQuestionCount: 0,
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectionMode: "source_order",
    planNonce: crypto.randomUUID(),
    scheduleEnabled: true,
    immediateDate: today,
    schedule: {
      startDate: today,
      weekdays: [],
      availableTimeEnabled: false,
      availableTime: "16:00",
      deadlineDayOffset: initialDeadline.dayOffset,
      deadlineTime: initialDeadline.time,
    },
    sessionScheduleOverrides: {},
    collisionDecisionRecords: [],
  };
}

export function resolveInitialVocabDeadline(
  today: string,
  currentLocalDateTime: string,
) {
  const currentDate = currentLocalDateTime.slice(0, 10);
  const currentTime = currentLocalDateTime.slice(11, 16);
  if (currentDate !== today || !/^\d{2}:\d{2}$/.test(currentTime)) {
    return { dayOffset: 0, time: "22:00" } as const;
  }
  if (currentTime < "21:45") {
    return { dayOffset: 0, time: "22:00" } as const;
  }
  if (currentTime < "23:45") {
    return { dayOffset: 0, time: "23:59" } as const;
  }
  return { dayOffset: 1, time: "22:00" } as const;
}
