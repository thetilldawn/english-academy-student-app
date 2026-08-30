import type { ExamSettings } from "./model";
import {
  ISO_WEEKDAYS,
  type IsoWeekday,
  type VocabScheduleDraft,
  type VocabScheduleSlot,
  type VocabScheduleSlotOverride,
  type VocabTimeTemplate,
  type VocabUnitSelection,
} from "./vocab-assignment-contract";

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
