"use client";

import { useLayoutEffect, useMemo, useReducer } from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
import type { VocabCollisionDecisionInput } from "../domain/vocab-collision-decisions";
import { selectPreviousVocabExamConditions } from "../domain/vocab-previous-exam";
import {
  resolveExtraDateCancelSessionCount,
  type IsoWeekday,
  type VocabAssignmentMode,
  type VocabQuestionCountChoice,
  type VocabExtraDatePolicy,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabSplitOverflowPolicy,
  type VocabTargetSelectionMode,
  type VocabTimeTemplate,
  type VocabUnitAllocationMode,
} from "../domain/vocab-assignment-contract";
import {
  applyTimeTemplate,
  copyPreviousExamConditions,
  resolveVocabUnitSelection,
} from "../domain/vocab-planner-controls";
import {
  keepFirstSelectedWeekdays,
  shiftLocalDateTime,
} from "../domain/vocab-schedule";
import { buildVocabAssignmentFieldErrors } from "../presentation/vocab-assignment-field-errors";
import { useBulkAssignmentController } from "./use-bulk-assignment-controller";
import type { AssignmentTransport } from "../transport/assignment-transport";
import { useVocabAssignmentDerivedPlan } from "./use-vocab-assignment-derived-plan";
import { useVocabTimeTemplates } from "./use-vocab-time-templates";
import {
  createInitialVocabPlannerState,
  vocabPlannerReducer,
} from "./vocab-assignment-planner-state";

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
  currentLocalDateTime = `${today}T00:00`,
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
  currentLocalDateTime?: string;
  transport?: AssignmentTransport;
  units: readonly AssignmentUnitItem[];
}) {
  const [planner, dispatch] = useReducer(
    vocabPlannerReducer,
    undefined,
    () => createInitialVocabPlannerState(
      datasets,
      initialDatasetId,
      today,
      currentLocalDateTime,
    ),
  );

  const availableUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.datasetId === planner.datasetId)
        .toSorted((left, right) => left.sortIndex - right.sortIndex),
    [planner.datasetId, units],
  );
  const selectedUnits = useMemo(
    () => resolveVocabUnitSelection(availableUnits, planner.range),
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
  const {
    commonPlan,
    distribution,
    effectiveSplitBasis,
    localIssues,
    scheduleSlots,
    unitAllocation,
  } = useVocabAssignmentDerivedPlan({ planner, selectedUnits });
  const bulk = useBulkAssignmentController({
    commonPlanRequired: true,
    firstAvailableDateKorean:
      planner.scheduleEnabled !== false
        ? scheduleSlots[0]?.date ?? planner.schedule.startDate
        : planner.immediateDate ?? planner.schedule.startDate,
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
    timeLimitEnabled: bulk.state.draft.exam.timeLimitEnabled !== false,
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
    bulk.actions.changeTimeLimitEnabled(applied.exam.timeLimitEnabled !== false);
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
        patch: {
          ...previousExam.scheduleRule,
          availableTimeEnabled: true,
        },
      });
    }
    if (previousExam.unitAllocation) {
      dispatch({ type: "schedule/enabled", enabled: true });
      dispatch({ type: "assignment_mode", value: "per_session" });
      dispatch({
        type: "unit_allocation_mode",
        value: previousExam.unitAllocation.rule.mode,
      });
      dispatch({
        type: "units_per_session",
        value: previousExam.unitAllocation.rule.unitsPerSession,
      });
      for (const weekday of [1, 2, 3, 4, 5, 6, 7] as const) {
        dispatch({
          type: "weekday_units_per_session",
          weekday,
          value: previousExam.unitAllocation.rule
            .weekdayUnitsPerSession[weekday],
        });
      }
      dispatch({
        type: "overflow_policy",
        value: previousExam.unitAllocation.overflowPolicy,
      });
    }
    bulk.actions.changeDirection(copied.exam.directionRatio);
    bulk.actions.changeOrder(copied.exam.questionOrderMode);
    bulk.actions.changePassingScore(copied.exam.passingScore);
    bulk.actions.changeTimeLimitEnabled(copied.exam.timeLimitEnabled !== false);
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

  const previewFieldIssues = (bulk.preview?.items ?? []).flatMap((item) => {
    if (!item.error || !item.errorFieldKey) return [];
    const path = item.errorFieldKey === "dataset"
      ? "commonPlan.datasetId"
      : item.errorFieldKey === "students"
        ? "studentIds"
        : item.errorFieldKey === "range"
          ? "commonPlan.sessions.0.unitIds"
          : item.errorFieldKey === "questionCount"
            ? "commonPlan.questionCount"
            : item.errorFieldKey === "overflowPolicy"
              ? "commonPlan.overflowPolicy"
              : "preview";
    return [{
      code: "invalid_order" as const,
      path,
      message: item.error,
    }];
  });
  const requiresExtraDateDecision = Boolean(
    unitAllocation?.requiresExtraDateDecision ||
      bulk.preview?.items.some((item) => item.requiresExtraDateDecision),
  );
  const extraDateIssues = requiresExtraDateDecision
    ? [{
        code: "invalid_order" as const,
        path: "commonPlan.extraDatePolicy",
        message: "추가 날짜의 범위 반복 여부를 선택해 주세요.",
      }]
    : [];

  const fieldValidation = buildVocabAssignmentFieldErrors([
    ...localIssues,
    ...extraDateIssues,
    ...(bulk.submissionIssues ?? []),
    ...previewFieldIssues,
  ]);
  const summary = bulk.preview?.commonPlanSummary ?? null;
  const representative = bulk.preview?.items.find(
    (item) => item.defaultSessionCount !== null,
  ) ?? null;
  const defaultSessionCount = effectiveSplitBasis === "range_unit"
    ? unitAllocation?.defaultSessionCount ?? 0
    : summary?.defaultSessionCount ??
      representative?.defaultSessionCount ??
      0;
  const extraDateDecisionSessionCount = resolveExtraDateCancelSessionCount(
    bulk.preview?.items ?? [],
    defaultSessionCount,
  );
  const scheduledQuestionCount =
    summary?.scheduledQuestionCount ??
    representative?.scheduledQuestionCount ??
    0;
  const canSubmit =
    localIssues.length === 0 &&
    !requiresExtraDateDecision &&
    bulk.canSubmit;

  return {
    actions: {
      applyTemplate,
      changeDataset: (value: string) => dispatch({ type: "dataset", value }),
      changeCollisionDecision,
      changeAssignmentMode: (value: VocabAssignmentMode) =>
        dispatch({ type: "assignment_mode", value }),
      changeUnitAllocationMode: (value: VocabUnitAllocationMode) =>
        dispatch({ type: "unit_allocation_mode", value }),
      changeUnitsPerSession: (value: number) =>
        dispatch({ type: "units_per_session", value }),
      changeWeekdayUnitsPerSession: (weekday: IsoWeekday, value: number) =>
        dispatch({ type: "weekday_units_per_session", weekday, value }),
      changeQuestionCountMode: (value: VocabQuestionCountChoice["mode"]) =>
        dispatch({ type: "question_count_mode", value }),
      activateManualQuestionCount: (defaultValue: number) => {
        if (planner.manualQuestionCount < 1) {
          dispatch({ type: "manual_question_count", value: defaultValue });
        }
        dispatch({ type: "question_count_mode", value: "manual" });
      },
      changeManualQuestionCount: (value: number) =>
        dispatch({ type: "manual_question_count", value }),
      changeOverflowPolicy: (value: VocabSplitOverflowPolicy) =>
        dispatch({ type: "overflow_policy", value }),
      changeExtraDatePolicy: (value: VocabExtraDatePolicy) =>
        dispatch({ type: "extra_date_policy", value }),
      changeSelectionMode: (value: VocabTargetSelectionMode) => {
        dispatch({ type: "selection_mode", value });
      },
      copyPreviousExam,
      decideCollision,
      clearCollisionDecision: (collisionId: string) =>
        dispatch({ type: "decision/clear_from", collisionId }),
      cancelExtraDates: () => dispatch({
        type: "schedule/update",
        patch: { weekdays: keepFirstSelectedWeekdays(
          planner.schedule,
          extraDateDecisionSessionCount,
        ) },
      }),
      saveCurrentTemplate: timeTemplateController.saveCurrentTemplate,
      changeScheduleEnabled: (enabled: boolean) =>
        dispatch({ type: "schedule/enabled", enabled }),
      selectUnit: (unitId: string) =>
        dispatch({ type: "range/toggle", unitId }),
      selectAllUnits: (selectAll: boolean) => dispatch({
        type: "range/all",
        unitIds: availableUnits.map((unit) => unit.id),
        selectAll,
      }),
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
    distribution,
    canSubmit,
    customTemplates: timeTemplateController.customTemplates,
    collisionDecisionRecords: planner.collisionDecisionRecords,
    hasPreviousExam: previousExam !== null,
    previousExam,
    planner,
    fieldErrors: fieldValidation.errors,
    firstFieldKey: fieldValidation.firstFieldKey,
    blockedReason:
      fieldValidation.blockerReason ??
      (!bulk.canSubmit ? bulk.message || "배정 후보를 확인해 주세요." : null),
    scheduleSlots,
    defaultSessionCount,
    extraDateDecisionSessionCount,
    scheduledQuestionCount,
    requiresExtraDateDecision,
    selectedUnits,
    templateSaving: timeTemplateController.saving,
    timeTemplates: timeTemplateController.timeTemplates,
    unitAllocation,
  };
}

export type VocabAssignmentPlannerController = ReturnType<
  typeof useVocabAssignmentPlanner
>;
