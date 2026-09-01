import type { AssignmentDatasetItem } from "../catalog-types";
import {
  type IsoWeekday,
  type VocabAssignmentMode,
  type VocabUnitSelection,
  type VocabQuestionCountChoice,
  type VocabExtraDatePolicy,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabSplitOverflowPolicy,
  type VocabTargetSelectionMode,
  type VocabUnitAllocationMode,
  type VocabWeekdayUnitCounts,
} from "../domain/vocab-assignment-contract";
import {
  resolveVocabUnitSelection,
  selectAllVocabUnits,
  selectInitialVocabDatasetId,
  toggleVocabUnitSelection,
  toggleWeekday,
} from "../domain/vocab-planner-controls";

export type VocabPlannerState = {
  datasetId: string;
  range: VocabUnitSelection;
  assignmentMode: VocabAssignmentMode;
  unitAllocationMode: VocabUnitAllocationMode;
  unitsPerSession: number;
  weekdayUnitsPerSession: VocabWeekdayUnitCounts;
  questionCountMode: VocabQuestionCountChoice["mode"];
  manualQuestionCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  extraDatePolicy: VocabExtraDatePolicy;
  selectionMode: VocabTargetSelectionMode;
  planNonce: string;
  scheduleEnabled?: boolean;
  schedule: VocabScheduleDraft;
  sessionScheduleOverrides: Readonly<
    Record<number, VocabScheduleSlotOverride>
  >;
};

export type VocabPlannerAction =
  | { type: "dataset"; value: string }
  | {
      type: "range/toggle";
      unitId: string;
      units: readonly { id: string; sortIndex: number }[];
    }
  | { type: "range/all"; unitIds: readonly string[]; selectAll: boolean }
  | { type: "assignment_mode"; value: VocabAssignmentMode }
  | { type: "unit_allocation_mode"; value: VocabUnitAllocationMode }
  | { type: "units_per_session"; value: number }
  | {
      type: "weekday_units_per_session";
      weekday: IsoWeekday;
      value: number;
    }
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
    };

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
      };
    case "range/toggle": {
      const toggledRange = toggleVocabUnitSelection(state.range, action.unitId);
      return {
        ...state,
        range: {
          selectedUnitIds: resolveVocabUnitSelection(
            action.units,
            toggledRange,
          ).map((unit) => unit.id),
        },
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    }
    case "range/all":
      return {
        ...state,
        range: selectAllVocabUnits(action.unitIds, action.selectAll),
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
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
      };
    case "unit_allocation_mode":
      return {
        ...state,
        unitAllocationMode: action.value,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    case "units_per_session":
      return {
        ...state,
        unitsPerSession: action.value,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    case "weekday_units_per_session":
      return {
        ...state,
        weekdayUnitsPerSession: {
          ...state.weekdayUnitsPerSession,
          [action.weekday]: action.value,
        },
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    case "question_count_mode":
      return {
        ...state,
        questionCountMode: action.value,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    case "manual_question_count":
      return {
        ...state,
        manualQuestionCount: action.value,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    case "overflow_policy":
      return {
        ...state,
        overflowPolicy: action.value,
      };
    case "extra_date_policy":
      return {
        ...state,
        extraDatePolicy: action.value,
      };
    case "selection_mode":
      return {
        ...state,
        selectionMode: action.value,
      };
    case "schedule/enabled": {
      const shouldNormalizeRangeSplit =
        !action.enabled && state.assignmentMode === "per_session";
      return {
        ...state,
        scheduleEnabled: action.enabled,
        assignmentMode: shouldNormalizeRangeSplit
          ? "all_sessions"
          : state.assignmentMode,
        overflowPolicy: shouldNormalizeRangeSplit
          ? "leave"
          : state.overflowPolicy,
        extraDatePolicy: "unconfirmed",
        sessionScheduleOverrides: {},
      };
    }
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
      };
    case "session_schedule":
      return {
        ...state,
        sessionScheduleOverrides: {
          ...state.sessionScheduleOverrides,
          [action.sessionNumber]: { ...action.value },
        },
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
    unitAllocationMode: "same",
    unitsPerSession: 1,
    weekdayUnitsPerSession: {
      1: 1,
      2: 1,
      3: 1,
      4: 1,
      5: 1,
      6: 1,
      7: 1,
    },
    questionCountMode: "all",
    manualQuestionCount: 0,
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    selectionMode: "source_order",
    planNonce: crypto.randomUUID(),
    scheduleEnabled: true,
    schedule: {
      startDate: today,
      weekdays: [],
      availableTimeEnabled: false,
      availableTime: "16:00",
      deadlineDayOffset: initialDeadline.dayOffset,
      deadlineTime: initialDeadline.time,
    },
    sessionScheduleOverrides: {},
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
