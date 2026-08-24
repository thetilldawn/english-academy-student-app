"use client";

import { useMemo } from "react";

import type { AssignmentUnitItem } from "../catalog-types";
import { validateVocabPlannerInputs } from "../domain/vocab-planner-validation";
import {
  applyScheduleSlotOverride,
  buildScheduleSlots,
  extendScheduleSlotsFromRecurrence,
  resolveVocabAssignmentMode,
  resolveVocabUnitCycleAllocation,
  type IsoWeekday,
  type VocabQuestionCountChoice,
  type VocabSplitBasis,
} from "../domain/vocab-assignment-plan";
import type { VocabPlannerState } from "./vocab-assignment-planner-state";

export function useVocabAssignmentDerivedPlan({
  planner,
  selectedUnits,
}: {
  planner: VocabPlannerState;
  selectedUnits: readonly AssignmentUnitItem[];
}) {
  const allScheduleSlots = useMemo(
    () => planner.scheduleEnabled !== false ? buildScheduleSlots(planner.schedule) : [],
    [planner.schedule, planner.scheduleEnabled],
  );
  const scheduleSlots = useMemo(
    () =>
      Object.entries(planner.sessionScheduleOverrides).reduce(
        (slots, [sessionNumber, override]) => {
          const effectiveOverride = planner.schedule.availableTimeEnabled === false
            ? {
                ...override,
                availableLocalDateTime:
                  `${override.availableLocalDateTime.slice(0, 10)}T00:00`,
              }
            : override;
          return applyScheduleSlotOverride(
            slots,
            Number(sessionNumber),
            effectiveOverride,
          );
        },
        allScheduleSlots,
      ),
    [
      allScheduleSlots,
      planner.schedule.availableTimeEnabled,
      planner.sessionScheduleOverrides,
    ],
  );
  const previewScheduleSlots = useMemo(() => {
    if (scheduleSlots.length > 0) return scheduleSlots;
    const parsed = new Date(`${planner.schedule.startDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return [];
    const day = parsed.getUTCDay();
    const weekday = (day === 0 ? 7 : day) as IsoWeekday;
    return buildScheduleSlots({
      ...planner.schedule,
      weekdays: [weekday],
    }).slice(0, 1);
  }, [planner.schedule, scheduleSlots]);
  const assignmentModePlan = resolveVocabAssignmentMode(
    planner.assignmentMode,
  );
  const distribution = assignmentModePlan.distribution;
  const effectiveSplitBasis: VocabSplitBasis =
    planner.scheduleEnabled !== false && distribution === "split"
      ? assignmentModePlan.splitBasis
      : "question_count";
  const baseSessionUnitCounts = useMemo(
    () => allScheduleSlots.map(() => 1),
    [allScheduleSlots],
  );
  const unitAllocation = useMemo(
    () => effectiveSplitBasis === "range_unit"
      ? resolveVocabUnitCycleAllocation({
          orderedUnitIds: selectedUnits.map((unit) => unit.id),
          baseSessionUnitCounts,
          selectedDateCount: scheduleSlots.length,
          overflowPolicy: planner.overflowPolicy,
          extraDatePolicy: planner.extraDatePolicy,
        })
      : null,
    [
      baseSessionUnitCounts,
      effectiveSplitBasis,
      planner.extraDatePolicy,
      planner.overflowPolicy,
      scheduleSlots.length,
      selectedUnits,
    ],
  );
  const questionCount = useMemo<VocabQuestionCountChoice>(
    () => planner.assignmentMode !== "word_count" ||
        planner.questionCountMode === "all"
      ? { mode: "all" }
      : { mode: "manual", value: planner.manualQuestionCount },
    [
      planner.assignmentMode,
      planner.manualQuestionCount,
      planner.questionCountMode,
    ],
  );
  const localIssues = useMemo(
    () => validateVocabPlannerInputs({
      datasetId: planner.datasetId,
      selectedUnitIds: selectedUnits.map((unit) => unit.id),
      distribution,
      splitBasis: effectiveSplitBasis,
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
      questionCount,
      overflowPolicy: planner.overflowPolicy,
      selectionMode: planner.selectionMode,
      scheduleEnabled: planner.scheduleEnabled,
      schedule: planner.schedule,
      scheduleSlots,
    }),
    [
      effectiveSplitBasis,
      planner.datasetId,
      distribution,
      planner.overflowPolicy,
      planner.schedule,
      planner.selectionMode,
      planner.scheduleEnabled,
      questionCount,
      scheduleSlots,
      selectedUnits,
    ],
  );
  const commonPlan = useMemo(() => {
    const unitIds = selectedUnits.map((unit) => unit.id);
    if (planner.scheduleEnabled === false) {
      const previewBlockingIssues = localIssues.filter(
        (issue) => issue.path !== "commonPlan.sessions",
      );
      const immediateLocalDateTime = `${planner.immediateDate ?? planner.schedule.startDate}T00:00`;
      return previewBlockingIssues.length === 0 && unitIds.length > 0
        ? {
            datasetId: planner.datasetId,
            distribution: "repeat" as const,
            splitBasis: "question_count" as const,
            orderedUnitIds: unitIds,
            rangeUnitCounts: [],
            questionCount,
            overflowPolicy: "leave" as const,
            extraDatePolicy: "unconfirmed" as const,
            selectedDateCount: 0,
            selectionMode: planner.selectionMode,
            planNonce: planner.planNonce,
            sessions: [{
              unitIds,
              availableLocalDateTime: immediateLocalDateTime,
              deadlineLocalDateTime: null,
            }],
            recurrenceSessions: [{
              availableLocalDateTime: immediateLocalDateTime,
              deadlineLocalDateTime: null,
            }],
            collisionDecisions: planner.collisionDecisionRecords.map(
              (record) => record.decision,
            ),
          }
        : undefined;
    }
    const basePlanScheduleSlots = scheduleSlots.length > 0
      ? scheduleSlots
      : previewScheduleSlots;
    const recurrenceScheduleSlots = scheduleSlots.length > 0
      ? allScheduleSlots
      : previewScheduleSlots;
    const planScheduleSlots = effectiveSplitBasis === "range_unit" &&
        unitAllocation && !unitAllocation.issue
      ? extendScheduleSlotsFromRecurrence(
          basePlanScheduleSlots,
          recurrenceScheduleSlots,
          unitAllocation.sessionUnitIds.length,
        )
      : basePlanScheduleSlots;
    const sessions = planScheduleSlots.map((slot) => ({
      unitIds: effectiveSplitBasis === "range_unit"
        ? unitAllocation?.sessionUnitIds[slot.sessionNumber - 1] ?? []
        : unitIds,
      availableLocalDateTime: slot.availableLocalDateTime,
      deadlineLocalDateTime: slot.deadlineLocalDateTime,
    }));
    const recurrenceSessions = recurrenceScheduleSlots.map((slot) => ({
      availableLocalDateTime: slot.availableLocalDateTime,
      deadlineLocalDateTime: slot.deadlineLocalDateTime,
    }));
    const previewBlockingIssues = localIssues.filter(
      (issue) => issue.path !== "commonPlan.sessions",
    );

    return previewBlockingIssues.length === 0 && sessions.length > 0
      ? {
          datasetId: planner.datasetId,
          distribution,
          splitBasis: effectiveSplitBasis,
          orderedUnitIds: unitIds,
          rangeUnitCounts: effectiveSplitBasis === "range_unit"
            ? baseSessionUnitCounts
            : [],
          questionCount,
          overflowPolicy:
            distribution === "split"
              ? planner.overflowPolicy
              : "leave" as const,
          extraDatePolicy: planner.extraDatePolicy,
          selectedDateCount: scheduleSlots.length,
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
    allScheduleSlots,
    baseSessionUnitCounts,
    effectiveSplitBasis,
    distribution,
    localIssues,
    planner.collisionDecisionRecords,
    planner.datasetId,
    planner.extraDatePolicy,
    planner.overflowPolicy,
    planner.planNonce,
    planner.selectionMode,
    planner.scheduleEnabled,
    planner.schedule.startDate,
    planner.immediateDate,
    previewScheduleSlots,
    questionCount,
    scheduleSlots,
    selectedUnits,
    unitAllocation,
  ]);

  return {
    allScheduleSlots,
    baseSessionUnitCounts,
    commonPlan,
    distribution,
    effectiveSplitBasis,
    localIssues,
    questionCount,
    scheduleSlots,
    unitAllocation,
  };
}
