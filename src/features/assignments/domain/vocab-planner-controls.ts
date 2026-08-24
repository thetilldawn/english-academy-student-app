import type { ExamSettings } from "./model";
import {
  ISO_WEEKDAYS,
  type IsoWeekday,
  type ResolvedVocabPlan,
  type VocabCollisionDecision,
  type VocabPlanCandidate,
  type VocabPlanCollision,
  type VocabScheduleDraft,
  type VocabScheduleSlot,
  type VocabScheduleSlotOverride,
  type VocabTimeTemplate,
  type VocabUnitSelection,
} from "./vocab-assignment-contract";
import { parseCalendarDate } from "./vocab-schedule";

export function toggleWeekday(
  weekdays: readonly IsoWeekday[],
  weekday: IsoWeekday,
): IsoWeekday[] {
  const selected = new Set(weekdays);
  if (selected.has(weekday)) selected.delete(weekday);
  else selected.add(weekday);
  return ISO_WEEKDAYS.filter((candidate) => selected.has(candidate));
}

export function selectInitialVocabDatasetId(
  datasets: readonly { id: string }[],
  requestedDatasetId: string,
) {
  return requestedDatasetId &&
      datasets.some((dataset) => dataset.id === requestedDatasetId)
    ? requestedDatasetId
    : "";
}

export function toggleVocabUnitSelection(
  current: VocabUnitSelection,
  unitId: string,
): VocabUnitSelection {
  const selected = new Set(current.selectedUnitIds);
  if (selected.has(unitId)) selected.delete(unitId);
  else selected.add(unitId);
  return { selectedUnitIds: [...selected] };
}

export function selectAllVocabUnits(
  unitIds: readonly string[],
  selectAll: boolean,
): VocabUnitSelection {
  return { selectedUnitIds: selectAll ? [...unitIds] : [] };
}

export function resolveVocabUnitSelection<
  T extends { id: string; sortIndex: number },
>(
  units: readonly T[],
  selection: VocabUnitSelection,
): T[] {
  const selectedIds = new Set(selection.selectedUnitIds);
  return [...units].sort(
    (left, right) => left.sortIndex - right.sortIndex,
  ).filter((unit) => selectedIds.has(unit.id));
}

export function applyTimeTemplate<T extends {
  schedule: VocabScheduleDraft;
  exam: ExamSettings;
}>(draft: T, template: VocabTimeTemplate): T {
  return {
    ...draft,
    schedule: {
      ...draft.schedule,
      availableTimeEnabled: true,
      availableTime: template.availableTime,
      deadlineDayOffset: template.deadlineDayOffset,
      deadlineTime: template.deadlineTime,
    },
    exam: {
      ...draft.exam,
      timeLimitEnabled: template.timeLimitEnabled !== false,
      timing: { ...template.timing },
    },
  };
}

export function applyScheduleSlotOverride(
  slots: readonly VocabScheduleSlot[],
  sessionNumber: number,
  override: VocabScheduleSlotOverride,
): VocabScheduleSlot[] {
  return slots.map((slot) =>
    slot.sessionNumber === sessionNumber
      ? {
          ...slot,
          ...override,
          date: override.availableLocalDateTime.slice(0, 10),
        }
      : { ...slot },
  );
}

export function copyPreviousExamConditions<T extends { exam: ExamSettings }>(
  draft: T,
  previous: ExamSettings,
): T {
  return {
    ...draft,
    exam: {
      ...previous,
      timing: { ...previous.timing },
    },
  };
}

export function applyCollisionDecisions(input: {
  candidates: readonly VocabPlanCandidate[];
  collisions: readonly VocabPlanCollision[];
  decisions: readonly VocabCollisionDecision[];
}): ResolvedVocabPlan {
  const decisionByCollision = new Map(
    input.decisions.map((decision) => [decision.collisionId, decision]),
  );
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const skipped = new Set<string>();
  const movedDates = new Map<string, string>();
  const unresolvedCollisionIds: string[] = [];

  for (const collision of input.collisions) {
    if (!candidateById.has(collision.candidateId)) continue;
    const decision = decisionByCollision.get(collision.id);
    if (!decision) {
      unresolvedCollisionIds.push(collision.id);
      continue;
    }
    if (decision.mode === "skip") skipped.add(collision.candidateId);
    if (decision.mode === "move") {
      if (!decision.movedDate || !parseCalendarDate(decision.movedDate)) {
        unresolvedCollisionIds.push(collision.id);
      } else {
        movedDates.set(collision.candidateId, decision.movedDate);
      }
    }
  }

  return {
    candidates: input.candidates.flatMap((candidate) =>
      skipped.has(candidate.id)
        ? []
        : [{
            ...candidate,
            unitIds: [...candidate.unitIds],
            date: movedDates.get(candidate.id) ?? candidate.date,
          }],
    ),
    unresolvedCollisionIds,
    skippedCandidateIds: [...skipped],
  };
}
