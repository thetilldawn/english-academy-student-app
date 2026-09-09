"use client";

import { useMemo } from "react";

import type { AssignmentUnitItem } from "../catalog-types";
import { validateVocabPlannerInputs } from "../domain/vocab-planner-validation";
import {
  resolveVocabAssignmentMode,
  type VocabQuestionCountChoice,
  type VocabSplitBasis,
} from "../domain/vocab-assignment-contract";
import { applyScheduleSlotOverride } from "../domain/vocab-planner-controls";
import {
  buildScheduleSlots,
  extendScheduleSlotsFromRecurrence,
  hasVocabScheduleDates,
  resolveVocabBaseSessionUnitCounts,
} from "../domain/vocab-schedule";
import {
  resolveUndatedVocabUnitCycleAllocation,
  resolveVocabUnitCycleAllocation,
} from "../domain/vocab-unit-allocation";
import type { VocabPlannerState } from "./vocab-assignment-planner-state";

export function useVocabAssignmentDerivedPlan({
  planner,
  selectedUnits,
}: {
  planner: VocabPlannerState;
  selectedUnits: readonly AssignmentUnitItem[];
}) {
  const usesDates = hasVocabScheduleDates(planner);
  const allScheduleSlots = useMemo(
    () => usesDates ? buildScheduleSlots(planner.schedule) : [],
    [planner.schedule, usesDates],
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
  const assignmentModePlan = resolveVocabAssignmentMode(
    planner.assignmentMode,
  );
  const distribution = assignmentModePlan.distribution;
  const effectiveSplitBasis: VocabSplitBasis = assignmentModePlan.splitBasis;
  const unitAllocationRule = useMemo(() => {
    return {
      schemaVersion: 1 as const,
      mode: "same" as const,
      unitsPerSession: planner.unitsPerSession,
      weekdayUnitsPerSession: {
        1: planner.unitsPerSession,
        2: planner.unitsPerSession,
        3: planner.unitsPerSession,
        4: planner.unitsPerSession,
        5: planner.unitsPerSession,
        6: planner.unitsPerSession,
        7: planner.unitsPerSession,
      },
    };
  }, [planner.unitsPerSession]);
  const baseSessionUnitCounts = useMemo(
    () => !usesDates &&
        effectiveSplitBasis === "range_unit"
      ? [planner.unitsPerSession]
      : resolveVocabBaseSessionUnitCounts({
          slots: allScheduleSlots,
          mode: "same",
          unitsPerSession: planner.unitsPerSession,
          weekdayUnitsPerSession: unitAllocationRule.weekdayUnitsPerSession,
        }),
    [
      allScheduleSlots,
      effectiveSplitBasis,
      usesDates,
      planner.unitsPerSession,
      unitAllocationRule.weekdayUnitsPerSession,
    ],
  );
  const unitAllocation = useMemo(
    () => effectiveSplitBasis === "range_unit"
      ? !usesDates
        ? resolveUndatedVocabUnitCycleAllocation({
            orderedUnitIds: selectedUnits.map((unit) => unit.id),
            unitsPerSession: planner.unitsPerSession,
          })
        : resolveVocabUnitCycleAllocation({
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
      usesDates,
      planner.unitsPerSession,
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
      unitsPerSession: planner.unitsPerSession,
      weekdayUnitsPerSession: unitAllocationRule.weekdayUnitsPerSession,
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
      planner.unitsPerSession,
      questionCount,
      scheduleSlots,
      selectedUnits,
      unitAllocationRule.weekdayUnitsPerSession,
    ],
  );
  const commonPlan = useMemo(() => {
    const unitIds = selectedUnits.map((unit) => unit.id);
    if (!usesDates) {
      const previewBlockingIssues = localIssues.filter(
        (issue) => issue.path !== "commonPlan.sessions",
      );
      if (effectiveSplitBasis === "range_unit") {
        return previewBlockingIssues.length === 0 &&
            unitAllocation &&
            !unitAllocation.issue &&
            unitAllocation.sessionUnitIds.length > 0
          ? {
              datasetId: planner.datasetId,
              distribution: "split" as const,
              splitBasis: "range_unit" as const,
              orderedUnitIds: unitIds,
              rangeUnitCounts: baseSessionUnitCounts,
              unitAllocationRule,
              questionCount,
              overflowPolicy: "leave" as const,
              extraDatePolicy: "unconfirmed" as const,
              selectedDateCount: 0,
              selectionMode: planner.selectionMode,
              planNonce: planner.planNonce,
              sessions: unitAllocation.sessionUnitIds.map((sessionUnitIds) => ({
                unitIds: sessionUnitIds,
                availableLocalDateTime: null,
                deadlineLocalDateTime: null,
              })),
              recurrenceSessions: [{
                availableLocalDateTime: null,
                deadlineLocalDateTime: null,
              }],
            }
          : undefined;
      }
      return previewBlockingIssues.length === 0 && unitIds.length > 0
        ? {
            datasetId: planner.datasetId,
            distribution,
            splitBasis: "question_count" as const,
            orderedUnitIds: unitIds,
            rangeUnitCounts: [],
            unitAllocationRule: null,
            questionCount,
            overflowPolicy: "leave" as const,
            extraDatePolicy: "unconfirmed" as const,
            selectedDateCount: 0,
            selectionMode: planner.selectionMode,
            planNonce: planner.planNonce,
            sessions: [{
              unitIds,
              availableLocalDateTime: null,
              deadlineLocalDateTime: null,
            }],
            recurrenceSessions: [{
              availableLocalDateTime: null,
              deadlineLocalDateTime: null,
            }],
          }
        : undefined;
    }
    const planScheduleSlots = effectiveSplitBasis === "range_unit" &&
        unitAllocation && !unitAllocation.issue
      ? extendScheduleSlotsFromRecurrence(
          scheduleSlots,
          allScheduleSlots,
          unitAllocation.sessionUnitIds.length,
        )
      : scheduleSlots;
    const sessions = planScheduleSlots.map((slot) => ({
      unitIds: effectiveSplitBasis === "range_unit"
        ? unitAllocation?.sessionUnitIds[slot.sessionNumber - 1] ?? []
        : unitIds,
      availableLocalDateTime: slot.availableLocalDateTime,
      deadlineLocalDateTime: slot.deadlineLocalDateTime,
    }));
    const recurrenceSessions = allScheduleSlots.map((slot) => ({
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
          unitAllocationRule: effectiveSplitBasis === "range_unit"
            ? unitAllocationRule
            : null,
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
        }
      : undefined;
  }, [
    allScheduleSlots,
    baseSessionUnitCounts,
    effectiveSplitBasis,
    distribution,
    localIssues,
    planner.datasetId,
    planner.extraDatePolicy,
    planner.overflowPolicy,
    planner.planNonce,
    planner.selectionMode,
    usesDates,
    questionCount,
    scheduleSlots,
    selectedUnits,
    unitAllocation,
    unitAllocationRule,
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
