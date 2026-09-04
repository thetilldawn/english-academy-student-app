import {
  ISO_WEEKDAYS,
  type IsoWeekday,
  type VocabExtraDatePolicy,
  type VocabScheduleDraft,
  type VocabScheduleSlot,
  type VocabUnitAllocationMode,
  type VocabWeekdayUnitCounts,
} from "./vocab-assignment-contract";
import { resolveVocabUnitCountsForDates } from "@/lib/admin/vocab-unit-allocation";

export { resolveVocabUnitCountsForDates } from "@/lib/admin/vocab-unit-allocation";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function parseCalendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const milliseconds = Date.UTC(year, month - 1, day);
  const parsed = new Date(milliseconds);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function formatCalendarDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isoWeekday(date: Date): IsoWeekday {
  const day = date.getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export function buildSelectedWeekdayDates(input: {
  startDate: string;
  weekdays: readonly IsoWeekday[];
}): string[] {
  const start = parseCalendarDate(input.startDate);
  const weekdays = new Set(input.weekdays);
  if (!start || weekdays.size === 0) {
    return [];
  }

  const startWeekday = isoWeekday(start);
  return ISO_WEEKDAYS
    .filter((weekday) => weekdays.has(weekday))
    .map((weekday) => ({
      offset: (weekday - startWeekday + 7) % 7,
      weekday,
    }))
    .sort((left, right) =>
      left.offset - right.offset || left.weekday - right.weekday)
    .map(({ offset }) => formatCalendarDate(
      new Date(start.getTime() + offset * DAY_MILLISECONDS),
    ));
}

export function keepFirstSelectedWeekdays(
  input: VocabScheduleDraft,
  count: number,
) {
  return buildSelectedWeekdayDates(input).slice(0, count).flatMap((date) => {
    const parsed = parseCalendarDate(date);
    return parsed ? [isoWeekday(parsed)] : [];
  });
}

export function resolveVocabRepeatCycleCount(
  selectedDateCount: number,
  baseSessionCount: number,
) {
  if (
    !Number.isInteger(selectedDateCount) ||
    selectedDateCount < 0 ||
    !Number.isInteger(baseSessionCount) ||
    baseSessionCount < 1
  ) {
    return 1;
  }
  return Math.max(1, Math.ceil(selectedDateCount / baseSessionCount));
}

export function reconcileVocabRepeatCycleApproval(input: {
  approvedCycleCount: number;
  selectedDateCount: number;
  baseSessionCount: number;
}): {
  approvedCycleCount: number;
  extraDatePolicy: VocabExtraDatePolicy;
  requiredCycleCount: number;
} {
  const requiredCycleCount = resolveVocabRepeatCycleCount(
    input.selectedDateCount,
    input.baseSessionCount,
  );
  const previousApprovedCycleCount =
    Number.isInteger(input.approvedCycleCount) && input.approvedCycleCount > 0
      ? input.approvedCycleCount
      : 1;
  const approvedCycleCount = Math.min(
    previousApprovedCycleCount,
    requiredCycleCount,
  );
  return {
    approvedCycleCount,
    extraDatePolicy:
      requiredCycleCount > 1 && requiredCycleCount <= approvedCycleCount
        ? "repeat_from_start"
        : "unconfirmed",
    requiredCycleCount,
  };
}

export function approveVocabRepeatCycle(input: {
  selectedDateCount: number;
  baseSessionCount: number;
}) {
  const approvedCycleCount = resolveVocabRepeatCycleCount(
    input.selectedDateCount,
    input.baseSessionCount,
  );
  return {
    approvedCycleCount,
    extraDatePolicy: approvedCycleCount > 1
      ? "repeat_from_start" as const
      : "unconfirmed" as const,
  };
}

export function shiftCalendarDate(value: string, days: number) {
  const date = parseCalendarDate(value);
  if (!date || !Number.isInteger(days)) return null;
  return formatCalendarDate(
    new Date(date.getTime() + days * DAY_MILLISECONDS),
  );
}

export function shiftLocalDateTime(value: string, days: number) {
  const [date, time] = value.split("T");
  const movedDate = shiftCalendarDate(date, days);
  return movedDate && time ? `${movedDate}T${time}` : value;
}

export function buildScheduleSlots(
  draft: VocabScheduleDraft,
): VocabScheduleSlot[] {
  const effectiveAvailableTime = draft.availableTimeEnabled === false
    ? "00:00"
    : draft.availableTime;
  if (
    !TIME_PATTERN.test(effectiveAvailableTime) ||
    !TIME_PATTERN.test(draft.deadlineTime) ||
    !Number.isInteger(draft.deadlineDayOffset) ||
    draft.deadlineDayOffset < 0 ||
    draft.deadlineDayOffset > 30
  ) {
    return [];
  }

  return buildSelectedWeekdayDates(draft).flatMap((date, index) => {
    const deadlineDate = shiftCalendarDate(date, draft.deadlineDayOffset);
    if (!deadlineDate) return [];
    return [{
      sessionNumber: index + 1,
      date,
      availableLocalDateTime: `${date}T${effectiveAvailableTime}`,
      deadlineLocalDateTime: `${deadlineDate}T${draft.deadlineTime}`,
    }];
  });
}

export function resolveVocabBaseSessionUnitCounts(input: {
  slots: readonly VocabScheduleSlot[];
  mode: VocabUnitAllocationMode;
  unitsPerSession: number;
  weekdayUnitsPerSession: VocabWeekdayUnitCounts;
}): number[] {
  return resolveVocabUnitCountsForDates({
    dates: input.slots.map((slot) => slot.date),
    rule: {
      schemaVersion: 1,
      mode: input.mode,
      unitsPerSession: input.unitsPerSession,
      weekdayUnitsPerSession: input.weekdayUnitsPerSession,
    },
  });
}

/** Repeats the concrete weekday slots in seven-day cycles. */
export function extendScheduleSlots(
  baseSlots: readonly VocabScheduleSlot[],
  requiredSessionCount: number,
): VocabScheduleSlot[] {
  if (
    baseSlots.length === 0 ||
    !Number.isInteger(requiredSessionCount) ||
    requiredSessionCount < 1
  ) {
    return [];
  }
  return Array.from({ length: requiredSessionCount }, (_, index) => {
    const source = baseSlots[index % baseSlots.length]!;
    const cycle = Math.floor(index / baseSlots.length);
    const availableLocalDateTime = shiftLocalDateTime(
      source.availableLocalDateTime,
      cycle * 7,
    );
    const deadlineLocalDateTime = shiftLocalDateTime(
      source.deadlineLocalDateTime,
      cycle * 7,
    );
    return {
      sessionNumber: index + 1,
      date: availableLocalDateTime.slice(0, 10),
      availableLocalDateTime,
      deadlineLocalDateTime,
    };
  });
}

/** Keeps edited base sessions while extending from the untouched weekday rule. */
export function extendScheduleSlotsFromRecurrence(
  baseSlots: readonly VocabScheduleSlot[],
  recurrenceBaseSlots: readonly VocabScheduleSlot[],
  requiredSessionCount: number,
): VocabScheduleSlot[] {
  if (baseSlots.length !== recurrenceBaseSlots.length) return [];
  const recurrence = extendScheduleSlots(
    recurrenceBaseSlots,
    requiredSessionCount,
  );
  return [
    ...baseSlots,
    ...recurrence.slice(baseSlots.length),
  ].slice(0, requiredSessionCount).map((slot, index) => ({
    ...slot,
    sessionNumber: index + 1,
  }));
}
