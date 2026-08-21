"use client";

import { useLayoutEffect, useMemo, useReducer } from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
import {
  clearVocabCollisionDecisionFrom,
  setVocabCollisionDecision,
  type VocabCollisionDecisionInput,
  type VocabCollisionDecisionRecord,
} from "../domain/vocab-collision-decisions";
import { selectPreviousVocabExamConditions } from "../domain/vocab-previous-exam";
import {
  advanceDayRangeSelection,
  applyScheduleSlotOverride,
  applyTimeTemplate,
  buildScheduleSlots,
  copyPreviousExamConditions,
  planUnitSessions,
  resolveDayRange,
  selectInitialVocabDatasetId,
  shiftLocalDateTime,
  toggleWeekday,
  type DayRangeSelection,
  type IsoWeekday,
  type VocabRangeDistribution,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabTimeTemplate,
} from "../domain/vocab-assignment-plan";
import { useBulkAssignmentController } from "./use-bulk-assignment-controller";
import type { AssignmentTransport } from "./assignment-transport";
import { useVocabTimeTemplates } from "./use-vocab-time-templates";
type PlannerState = {
  datasetId: string;
  range: DayRangeSelection;
  distribution: VocabRangeDistribution;
  targetWordsPerSession: number;
  schedule: VocabScheduleDraft;
  sessionScheduleOverrides: Readonly<Record<number, VocabScheduleSlotOverride>>;
  collisionDecisionRecords: readonly VocabCollisionDecisionRecord[];
};
type PlannerAction =
  | { type: "dataset"; value: string }
  | { type: "range"; unitId: string }
  | { type: "distribution"; value: VocabRangeDistribution }
  | { type: "target"; value: number }
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
function reducer(state: PlannerState, action: PlannerAction): PlannerState {
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
        collisionDecisionRecords: [],
      };
    case "target":
      return {
        ...state,
        targetWordsPerSession: action.value,
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

function initialState(
  datasets: readonly AssignmentDatasetItem[],
  initialDatasetId: string,
  today: string,
): PlannerState {
  const datasetId = selectInitialVocabDatasetId(datasets, initialDatasetId);
  return {
    datasetId,
    range: {
      startUnitId: null,
      endUnitId: null,
    },
    distribution: "split",
    targetWordsPerSession: 40,
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

export function useVocabAssignmentPlanner({
  datasets,
  genericErrorMessage,
  initialDatasetId,
  initialTimeTemplates = [],
  previousExamHistory,
  previousExamSourceStudentId,
  previewErrorMessage,
  studentIds,
  today,
  transport,
  units,
}: {
  datasets: readonly AssignmentDatasetItem[];
  genericErrorMessage: string;
  initialDatasetId: string;
  initialTimeTemplates?: readonly VocabTimeTemplate[];
  previousExamHistory: readonly AssignmentHistorySummary[];
  previousExamSourceStudentId: string;
  previewErrorMessage: string;
  studentIds: readonly string[];
  today: string;
  transport?: AssignmentTransport;
  units: readonly AssignmentUnitItem[];
}) {
  const [planner, dispatch] = useReducer(
    reducer,
    undefined,
    () => initialState(datasets, initialDatasetId, today),
  );

  const availableUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === planner.datasetId)
        .toSorted((left, right) => left.sortIndex - right.sortIndex),
    [planner.datasetId, units],
  );
  const selectedUnits = useMemo(
    () => resolveDayRange(availableUnits, planner.range),
    [availableUnits, planner.range],
  );
  const previousExam = useMemo(
    () =>
      selectPreviousVocabExamConditions({
        datasetId: planner.datasetId,
        history: previousExamHistory,
        studentId: previousExamSourceStudentId,
      }),
    [
      planner.datasetId,
      previousExamHistory,
      previousExamSourceStudentId,
    ],
  );
  const allScheduleSlots = useMemo(
    () => buildScheduleSlots(planner.schedule),
    [planner.schedule],
  );
  const candidateScheduleSlots = useMemo(
    () =>
      Object.entries(planner.sessionScheduleOverrides).reduce(
        (slots, [sessionNumber, override]) =>
          applyScheduleSlotOverride(slots, Number(sessionNumber), override),
        allScheduleSlots,
      ),
    [allScheduleSlots, planner.sessionScheduleOverrides],
  );
  const rangeSessions = useMemo(
    () =>
      planUnitSessions({
        orderedUnits: selectedUnits,
        distribution: planner.distribution,
        targetWordsPerSession: planner.targetWordsPerSession,
        sessionCount: candidateScheduleSlots.length,
      }),
    [
      planner.distribution,
      planner.targetWordsPerSession,
      candidateScheduleSlots.length,
      selectedUnits,
    ],
  );
  const scheduleSlots = candidateScheduleSlots;
  const commonPlan = useMemo(() => {
    const sessions = rangeSessions.flatMap((rangeSession, index) => {
      const slot = scheduleSlots[index];
      return slot
        ? [{
            unitIds: rangeSession.units.map((unit) => unit.id),
            availableLocalDateTime: slot.availableLocalDateTime,
            deadlineLocalDateTime: slot.deadlineLocalDateTime,
          }]
        : [];
    });
    return sessions.length > 0 &&
        sessions.length === scheduleSlots.length &&
        planner.datasetId
      ? {
          datasetId: planner.datasetId,
          distribution: planner.distribution,
          targetWordsPerSession: planner.targetWordsPerSession,
          sessions,
          collisionDecisions: planner.collisionDecisionRecords.map(
            (record) => record.decision,
          ),
        }
      : undefined;
  }, [
    planner.collisionDecisionRecords,
    planner.datasetId,
    planner.distribution,
    planner.targetWordsPerSession,
    rangeSessions,
    scheduleSlots,
  ]);
  const bulk = useBulkAssignmentController({
    commonPlanRequired: true,
    firstAvailableDateKorean:
      scheduleSlots[0]?.date ?? planner.schedule.startDate,
    genericErrorMessage,
    includePendingReview: false,
    initialCommonPlan: commonPlan,
    previewErrorMessage,
    studentIds,
    transport,
  });
  const timeTemplateController = useVocabTimeTemplates({
    initialTemplates: initialTimeTemplates,
    schedule: planner.schedule,
    timing: bulk.state.draft.exam.timing,
    transport,
  });
  const changeCommonPlan = bulk.actions.changeCommonPlan;
  useLayoutEffect(() => {
    changeCommonPlan(commonPlan);
  }, [changeCommonPlan, commonPlan]);

  function updateSchedule(patch: Partial<VocabScheduleDraft>) {
    dispatch({ type: "schedule/update", patch });
  }

  function applyTemplate(template: VocabTimeTemplate) {
    const applied = applyTimeTemplate(
      { schedule: planner.schedule, exam: bulk.state.draft.exam },
      template,
    );
    dispatch({ type: "schedule/replace", value: applied.schedule });
    bulk.actions.changeTiming(applied.exam.timing);
  }

  function copyPrevious() {
    if (!previousExam) return;
    const copied = copyPreviousExamConditions(
      { exam: bulk.state.draft.exam },
      previousExam.exam,
    );
    if (previousExam.scheduleRule) {
      dispatch({
        type: "schedule/update",
        patch: previousExam.scheduleRule,
      });
    }
    bulk.actions.changeDirection(copied.exam.directionRatio);
    bulk.actions.changeOrder(copied.exam.questionOrderMode);
    bulk.actions.changePassingScore(copied.exam.passingScore);
    bulk.actions.changeTiming(copied.exam.timing);
  }

  function decideCollision(input: VocabCollisionDecisionInput) {
    const availableLocal = isoToKoreanDateTimeLocal(input.availableFrom);
    const deadlineLocal = isoToKoreanDateTimeLocal(input.availableUntil);
    dispatch({
      type: "decision/set",
      value: {
        ...input,
        decision: {
          collisionId: input.collisionId,
          mode: input.mode,
          ...(input.mode === "move"
            ? {
                movedAvailableLocalDateTime: shiftLocalDateTime(
                  availableLocal,
                  1,
                ),
                movedDeadlineLocalDateTime: shiftLocalDateTime(
                  deadlineLocal,
                  1,
                ),
              }
            : {}),
        },
      },
    });
  }

  function changeCollisionDecision(
    collisionId: string,
    mode: "skip" | "move" | "allow",
  ) {
    const record = planner.collisionDecisionRecords.find(
      (candidate) => candidate.decision.collisionId === collisionId,
    );
    if (!record) return;
    const currentAvailableLocal = record.decision.mode === "move"
      ? record.decision.movedAvailableLocalDateTime ?? ""
      : isoToKoreanDateTimeLocal(record.availableFrom);
    const currentDeadlineLocal = record.decision.mode === "move"
      ? record.decision.movedDeadlineLocalDateTime ?? ""
      : isoToKoreanDateTimeLocal(record.availableUntil);
    dispatch({
      type: "decision/set",
      value: {
        ...record,
        decision: {
          collisionId,
          mode,
          ...(mode === "move"
            ? {
                movedAvailableLocalDateTime: shiftLocalDateTime(
                  currentAvailableLocal,
                  1,
                ),
                movedDeadlineLocalDateTime: shiftLocalDateTime(
                  currentDeadlineLocal,
                  1,
                ),
              }
            : {}),
        },
      },
    });
  }

  function copyPreviousExam() {
    if (!previousExam) return false;
    copyPrevious();
    return true;
  }

  return {
    actions: {
      applyTemplate,
      changeDataset: (value: string) => dispatch({ type: "dataset", value }),
      changeCollisionDecision,
      changeDistribution: (value: VocabRangeDistribution) =>
        dispatch({ type: "distribution", value }),
      changeTargetWords: (value: number) => dispatch({ type: "target", value }),
      copyPreviousExam,
      decideCollision,
      clearCollisionDecision: (collisionId: string) =>
        dispatch({ type: "decision/clear_from", collisionId }),
      saveCurrentTemplate: timeTemplateController.saveCurrentTemplate,
      selectUnit: (unitId: string) => dispatch({ type: "range", unitId }),
      updateSessionSchedule: (
        sessionNumber: number,
        value: VocabScheduleSlotOverride,
      ) => dispatch({ type: "session_schedule", sessionNumber, value }),
      toggleWeekday: (weekday: IsoWeekday) =>
        dispatch({ type: "schedule/toggle_weekday", weekday }),
      updateSchedule,
    },
    availableUnits,
    bulk,
    commonPlan,
    customTemplates: timeTemplateController.customTemplates,
    collisionDecisionRecords: planner.collisionDecisionRecords,
    hasPreviousExam: previousExam !== null,
    previousExam,
    planner,
    rangeSessions,
    scheduleSlots,
    splitScheduleIssue:
      planner.distribution === "split" &&
      selectedUnits.length > 0 &&
      rangeSessions.length !== scheduleSlots.length,
    selectedUnits,
    templateSaving: timeTemplateController.saving,
    timeTemplates: timeTemplateController.timeTemplates,
  };
}

export type VocabAssignmentPlannerController = ReturnType<
  typeof useVocabAssignmentPlanner
>;
