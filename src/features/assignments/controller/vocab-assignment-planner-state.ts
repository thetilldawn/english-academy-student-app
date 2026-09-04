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
} from "../domain/vocab-assignment-contract";
import {
  resolveVocabUnitSelection,
  selectAllVocabUnits,
  selectInitialVocabDatasetId,
  toggleVocabUnitSelection,
  toggleWeekday,
} from "../domain/vocab-planner-controls";
import {
  approveVocabRepeatCycle,
  reconcileVocabRepeatCycleApproval,
} from "../domain/vocab-schedule";

export type VocabPlannerState = {
  datasetId: string;
  range: VocabUnitSelection;
  assignmentMode: VocabAssignmentMode;
  unitsPerSession: number;
  questionCountMode: VocabQuestionCountChoice["mode"];
  manualQuestionCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  extraDatePolicy: VocabExtraDatePolicy;
  approvedRepeatCycleCount: number;
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
  | { type: "units_per_session"; value: number }
  | { type: "question_count_mode"; value: VocabQuestionCountChoice["mode"] }
  | { type: "manual_question_count"; value: number }
  | { type: "overflow_policy"; value: VocabSplitOverflowPolicy }
  | {
      type: "extra_date_policy";
      value: VocabExtraDatePolicy;
      baseSessionCount?: number;
    }
  | { type: "selection_mode"; value: VocabTargetSelectionMode }
  | { type: "schedule/enabled"; enabled: boolean }
  | {
      type: "schedule/update";
      patch: Partial<VocabScheduleDraft>;
      baseSessionCount?: number;
    }
  | {
      type: "schedule/replace";
      value: VocabScheduleDraft;
      baseSessionCount?: number;
    }
  | {
      type: "schedule/toggle_weekday";
      weekday: IsoWeekday;
      baseSessionCount?: number;
    }
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
        approvedRepeatCycleCount: 1,
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
        approvedRepeatCycleCount: 1,
        sessionScheduleOverrides: {},
      };
    }
    case "range/all":
      return {
        ...state,
        range: selectAllVocabUnits(action.unitIds, action.selectAll),
        extraDatePolicy: "unconfirmed",
        approvedRepeatCycleCount: 1,
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
        approvedRepeatCycleCount: 1,
        sessionScheduleOverrides: {},
      };
    case "units_per_session":
      return {
        ...state,
        unitsPerSession: action.value,
        extraDatePolicy: "unconfirmed",
        approvedRepeatCycleCount: 1,
        sessionScheduleOverrides: {},
      };
    case "question_count_mode":
      return {
        ...state,
        questionCountMode: action.value,
        extraDatePolicy: "unconfirmed",
        approvedRepeatCycleCount: 1,
        sessionScheduleOverrides: {},
      };
    case "manual_question_count":
      return {
        ...state,
        manualQuestionCount: action.value,
        extraDatePolicy: "unconfirmed",
        approvedRepeatCycleCount: 1,
        sessionScheduleOverrides: {},
      };
    case "overflow_policy":
      return {
        ...state,
        overflowPolicy: action.value,
      };
    case "extra_date_policy": {
      if (action.value !== "repeat_from_start") {
        return {
          ...state,
          extraDatePolicy: "unconfirmed",
          approvedRepeatCycleCount: 1,
        };
      }
      const approval = approveVocabRepeatCycle({
        selectedDateCount: state.schedule.weekdays.length,
        baseSessionCount: action.baseSessionCount ?? 0,
      });
      return {
        ...state,
        extraDatePolicy: approval.extraDatePolicy,
        approvedRepeatCycleCount: approval.approvedCycleCount,
      };
    }
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
        approvedRepeatCycleCount: 1,
        sessionScheduleOverrides: {},
      };
    }
    case "schedule/update": {
      const scheduleShapeChanged =
        action.patch.weekdays !== undefined ||
        action.patch.startDate !== undefined;
      const schedule = { ...state.schedule, ...action.patch };
      const approval = action.patch.weekdays !== undefined
        ? reconcileVocabRepeatCycleApproval({
            approvedCycleCount: state.approvedRepeatCycleCount,
            selectedDateCount: schedule.weekdays.length,
            baseSessionCount: action.baseSessionCount ?? 0,
          })
        : null;
      return {
        ...state,
        schedule,
        extraDatePolicy: approval?.extraDatePolicy ?? state.extraDatePolicy,
        approvedRepeatCycleCount:
          approval?.approvedCycleCount ?? state.approvedRepeatCycleCount,
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
      const approval = weekdaysChanged
        ? reconcileVocabRepeatCycleApproval({
            approvedCycleCount: state.approvedRepeatCycleCount,
            selectedDateCount: action.value.weekdays.length,
            baseSessionCount: action.baseSessionCount ?? 0,
          })
        : null;
      return {
        ...state,
        schedule: action.value,
        extraDatePolicy: approval?.extraDatePolicy ?? state.extraDatePolicy,
        approvedRepeatCycleCount:
          approval?.approvedCycleCount ?? state.approvedRepeatCycleCount,
        sessionScheduleOverrides: {},
      };
    }
    case "schedule/toggle_weekday": {
      const nextWeekdays = toggleWeekday(
        state.schedule.weekdays,
        action.weekday,
      );
      const approval = reconcileVocabRepeatCycleApproval({
        approvedCycleCount: state.approvedRepeatCycleCount,
        selectedDateCount: nextWeekdays.length,
        baseSessionCount: action.baseSessionCount ?? 0,
      });
      return {
        ...state,
        schedule: {
          ...state.schedule,
          weekdays: nextWeekdays,
        },
        extraDatePolicy: approval.extraDatePolicy,
        approvedRepeatCycleCount: approval.approvedCycleCount,
        sessionScheduleOverrides: {},
      };
    }
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
    unitsPerSession: 1,
    questionCountMode: "all",
    manualQuestionCount: 0,
    overflowPolicy: "leave",
    extraDatePolicy: "unconfirmed",
    approvedRepeatCycleCount: 1,
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
