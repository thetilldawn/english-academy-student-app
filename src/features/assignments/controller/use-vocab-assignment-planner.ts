"use client";

import { useLayoutEffect, useMemo, useReducer } from "react";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
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
import { useAssignmentPreviousExam } from "./use-assignment-previous-exam";

export function useVocabAssignmentPlanner({
  datasets,
  enabled = true,
  genericErrorMessage,
  initialDatasetId,
  initialTimeTemplates = [],
  previousExamSourceStudentId,
  previewErrorMessage,
  studentIds,
  today,
  currentLocalDateTime = `${today}T00:00`,
  transport,
  units,
}: {
  datasets: readonly AssignmentDatasetItem[];
  enabled?: boolean;
  genericErrorMessage: string;
  initialDatasetId: string;
  initialTimeTemplates?: readonly VocabTimeTemplate[];
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
  const previousExamRead = useAssignmentPreviousExam({
    datasetId: planner.datasetId,
    enabled,
    studentId: previousExamSourceStudentId,
  });
  const previousExam = useMemo(
    () => previousExamRead.data
      ? selectPreviousVocabExamConditions({
        datasetId: planner.datasetId,
        history: [previousExamRead.data],
        studentId: previousExamSourceStudentId,
      })
      : null,
    [
      planner.datasetId,
      previousExamRead.data,
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
    genericErrorMessage,
    initialCommonPlan: commonPlan,
    enabled,
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
    bulk.actions.changeRetryEnabled(copied.exam.retryEnabled !== false);
    bulk.actions.changeRetryPassingScore(
      copied.exam.retryPassingScore ?? copied.exam.passingScore,
    );
    bulk.actions.changeTimeLimitEnabled(copied.exam.timeLimitEnabled !== false);
    bulk.actions.changeTiming(copied.exam.timing);
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
      retryPreviousExam: previousExamRead.retry,
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
    hasPreviousExam: previousExam !== null,
    previousExam,
    previousExamError: previousExamRead.error,
    previousExamStatus: previousExamRead.status,
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
