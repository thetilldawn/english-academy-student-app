"use client";

import { useLayoutEffect, useMemo, useReducer } from "react";

import type { AssignmentHistorySummary } from "@/lib/admin/history";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentDatasetItem, AssignmentUnitItem } from "../catalog-types";
import {
  type VocabCollisionDecisionInput,
} from "../domain/vocab-collision-decisions";
import { selectPreviousVocabExamConditions } from "../domain/vocab-previous-exam";
import { validateVocabPlannerInputs } from "../domain/vocab-planner-validation";
import {
  applyScheduleSlotOverride,
  applyTimeTemplate,
  buildScheduleSlots,
  copyPreviousExamConditions,
  resolveDayRange,
  shiftLocalDateTime,
  type IsoWeekday,
  type VocabQuestionCountChoice,
  type VocabRangeDistribution,
  type VocabScheduleDraft,
  type VocabScheduleSlotOverride,
  type VocabSplitOverflowPolicy,
  type VocabTargetSelectionMode,
  type VocabTimeTemplate,
} from "../domain/vocab-assignment-plan";
import { buildVocabAssignmentFieldErrors } from "../presentation/vocab-assignment-field-errors";
import { useBulkAssignmentController } from "./use-bulk-assignment-controller";
import type { AssignmentTransport } from "./assignment-transport";
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
    vocabPlannerReducer,
    undefined,
    () => createInitialVocabPlannerState(datasets, initialDatasetId, today),
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
  const scheduleSlots = candidateScheduleSlots;
  const questionCount = useMemo<VocabQuestionCountChoice>(
    () => planner.questionCountMode === "all"
      ? { mode: "all" }
      : { mode: "manual", value: planner.manualQuestionCount },
    [planner.manualQuestionCount, planner.questionCountMode],
  );
  const localIssues = useMemo(
    () => validateVocabPlannerInputs({
      datasetId: planner.datasetId,
      selectedUnitIds: selectedUnits.map((unit) => unit.id),
      distribution: planner.distribution,
      questionCount,
      overflowPolicy: planner.overflowPolicy,
      selectionMode: planner.selectionMode,
      schedule: planner.schedule,
      scheduleSlots,
    }),
    [
      planner.datasetId,
      planner.distribution,
      planner.overflowPolicy,
      planner.schedule,
      planner.selectionMode,
      questionCount,
      scheduleSlots,
      selectedUnits,
    ],
  );
  const commonPlan = useMemo(() => {
    const unitIds = selectedUnits.map((unit) => unit.id);
    const sessions = scheduleSlots.map((slot) => ({
      unitIds,
      availableLocalDateTime: slot.availableLocalDateTime,
      deadlineLocalDateTime: slot.deadlineLocalDateTime,
    }));
    const recurrenceSessions = allScheduleSlots.map((slot) => ({
      availableLocalDateTime: slot.availableLocalDateTime,
      deadlineLocalDateTime: slot.deadlineLocalDateTime,
    }));
    return localIssues.length === 0
      ? {
          datasetId: planner.datasetId,
          distribution: planner.distribution,
          questionCount,
          overflowPolicy:
            planner.distribution === "split" &&
              planner.questionCountMode === "manual"
              ? planner.overflowPolicy
              : "leave" as const,
          selectionMode: planner.selectionMode,
          planNonce: planner.planNonce,
          sessions,
          recurrenceSessions,
          collisionDecisions: planner.collisionDecisionRecords.map(
            (record) => record.decision,
          ),
        }
      : undefined;
  }, [
    planner.collisionDecisionRecords,
    planner.datasetId,
    planner.distribution,
    planner.overflowPolicy,
    planner.planNonce,
    planner.questionCountMode,
    planner.selectionMode,
    localIssues.length,
    questionCount,
    allScheduleSlots,
    scheduleSlots,
    selectedUnits,
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

  const fieldValidation = buildVocabAssignmentFieldErrors([
    ...localIssues,
    ...(bulk.submissionIssues ?? []),
    ...previewFieldIssues,
  ]);

  return {
    actions: {
      applyTemplate,
      changeDataset: (value: string) => dispatch({ type: "dataset", value }),
      changeCollisionDecision,
      changeDistribution: (value: VocabRangeDistribution) =>
        dispatch({ type: "distribution", value }),
      changeQuestionCountMode: (value: VocabQuestionCountChoice["mode"]) =>
        dispatch({ type: "question_count_mode", value }),
      changeManualQuestionCount: (value: number) =>
        dispatch({ type: "manual_question_count", value }),
      changeOverflowPolicy: (value: VocabSplitOverflowPolicy) =>
        dispatch({ type: "overflow_policy", value }),
      changeSelectionMode: (value: VocabTargetSelectionMode) =>
        dispatch({ type: "selection_mode", value }),
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
    fieldErrors: fieldValidation.errors,
    firstFieldKey: fieldValidation.firstFieldKey,
    blockedReason:
      fieldValidation.blockerReason ??
      (!bulk.canSubmit ? bulk.message || "배정 후보를 확인해 주세요." : null),
    scheduleSlots,
    selectedUnits,
    templateSaving: timeTemplateController.saving,
    timeTemplates: timeTemplateController.timeTemplates,
  };
}

export type VocabAssignmentPlannerController = ReturnType<
  typeof useVocabAssignmentPlanner
>;
