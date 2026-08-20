import type { ExamSettings, ExamTiming } from "./model";

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];
export type VocabAssignmentEntryMode = "student" | "school" | "dataset";
export type VocabRangeDistribution = "split" | "repeat";
export type CollisionDecisionMode = "skip" | "move" | "allow";

export type DayRangeSelection = {
  startUnitId: string | null;
  endUnitId: string | null;
};

export type VocabScheduleDraft = {
  startDate: string;
  endDate: string;
  weekdays: readonly IsoWeekday[];
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
};

export type VocabTimeTemplate = {
  id: string;
  label: string;
  availableTime: string;
  deadlineDayOffset: number;
  deadlineTime: string;
  timing: ExamTiming;
};

export type VocabScheduleSlot = {
  sessionNumber: number;
  date: string;
  availableLocalDateTime: string;
  deadlineLocalDateTime: string;
};

export type VocabScheduleSlotOverride = Pick<
  VocabScheduleSlot,
  "availableLocalDateTime" | "deadlineLocalDateTime"
>;

export type UnitWithEntryCount = {
  id: string;
  sortIndex: number;
  entryCount: number;
};

export type VocabRangeSession<T extends UnitWithEntryCount> = {
  sessionNumber: number;
  units: T[];
  sourceWordCount: number;
};

export type VocabPlanCandidate = {
  id: string;
  studentId: string;
  sessionNumber: number;
  date: string;
  unitIds: readonly string[];
};

export type VocabPlanCollision = {
  id: string;
  candidateId: string;
  existingAssignmentId: string;
  message: string;
};

export type VocabCollisionDecision = {
  collisionId: string;
  mode: CollisionDecisionMode;
  movedDate?: string;
};

export type ResolvedVocabPlan = {
  candidates: VocabPlanCandidate[];
  unresolvedCollisionIds: string[];
  skippedCandidateIds: string[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function parseCalendarDate(value: string) {
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

export function buildWeekdayDates(input: {
  startDate: string;
  endDate: string;
  weekdays: readonly IsoWeekday[];
}): string[] {
  const start = parseCalendarDate(input.startDate);
  const end = parseCalendarDate(input.endDate);
  const weekdays = new Set(input.weekdays);
  if (!start || !end || start > end || weekdays.size === 0) return [];

  const dates: string[] = [];
  for (
    let value = start.getTime();
    value <= end.getTime();
    value += DAY_MILLISECONDS
  ) {
    const date = new Date(value);
    if (weekdays.has(isoWeekday(date))) {
      dates.push(formatCalendarDate(date));
    }
  }
  return dates;
}

export function shiftCalendarDate(value: string, days: number) {
  const date = parseCalendarDate(value);
  if (!date || !Number.isInteger(days)) return null;
  return formatCalendarDate(
    new Date(date.getTime() + days * DAY_MILLISECONDS),
  );
}

export function buildScheduleSlots(
  draft: VocabScheduleDraft,
): VocabScheduleSlot[] {
  if (
    !TIME_PATTERN.test(draft.availableTime) ||
    !TIME_PATTERN.test(draft.deadlineTime) ||
    !Number.isInteger(draft.deadlineDayOffset) ||
    draft.deadlineDayOffset < 0 ||
    draft.deadlineDayOffset > 30
  ) {
    return [];
  }

  return buildWeekdayDates(draft).flatMap((date, index) => {
    const deadlineDate = shiftCalendarDate(date, draft.deadlineDayOffset);
    if (!deadlineDate) return [];
    return [{
      sessionNumber: index + 1,
      date,
      availableLocalDateTime: `${date}T${draft.availableTime}`,
      deadlineLocalDateTime: `${deadlineDate}T${draft.deadlineTime}`,
    }];
  });
}

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

export function advanceDayRangeSelection(
  current: DayRangeSelection,
  unitId: string,
): DayRangeSelection {
  if (!current.startUnitId || current.endUnitId) {
    return { startUnitId: unitId, endUnitId: null };
  }
  if (current.startUnitId === unitId) {
    return { startUnitId: null, endUnitId: null };
  }
  return { startUnitId: current.startUnitId, endUnitId: unitId };
}

export function resolveDayRange<T extends { id: string; sortIndex: number }>(
  units: readonly T[],
  selection: DayRangeSelection,
): T[] {
  if (!selection.startUnitId) return [];
  const sorted = [...units].sort(
    (left, right) => left.sortIndex - right.sortIndex,
  );
  const startIndex = sorted.findIndex(
    (unit) => unit.id === selection.startUnitId,
  );
  const endIndex = sorted.findIndex(
    (unit) => unit.id ===
      (selection.endUnitId ?? selection.startUnitId),
  );
  if (startIndex < 0 || endIndex < 0) return [];
  const selected = sorted.slice(
    Math.min(startIndex, endIndex),
    Math.max(startIndex, endIndex) + 1,
  );
  return startIndex <= endIndex ? selected : selected.reverse();
}

export function planUnitSessions<T extends UnitWithEntryCount>(input: {
  orderedUnits: readonly T[];
  distribution: VocabRangeDistribution;
  targetWordsPerSession: number;
  maximumSessions: number;
}): VocabRangeSession<T>[] {
  const { orderedUnits } = input;
  if (
    orderedUnits.length === 0 ||
    !Number.isInteger(input.maximumSessions) ||
    input.maximumSessions < 1 ||
    !Number.isInteger(input.targetWordsPerSession) ||
    input.targetWordsPerSession < 1
  ) {
    return [];
  }

  if (input.distribution === "repeat") {
    const sourceWordCount = orderedUnits.reduce(
      (count, unit) => count + Math.max(0, unit.entryCount),
      0,
    );
    return Array.from({ length: input.maximumSessions }, (_, index) => ({
      sessionNumber: index + 1,
      units: [...orderedUnits],
      sourceWordCount,
    }));
  }

  const chunks: T[][] = [];
  let current: T[] = [];
  let currentCount = 0;
  for (const unit of orderedUnits) {
    current.push(unit);
    currentCount += Math.max(0, unit.entryCount);
    if (
      currentCount >= input.targetWordsPerSession &&
      chunks.length < input.maximumSessions - 1
    ) {
      chunks.push(current);
      current = [];
      currentCount = 0;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((units, index) => ({
    sessionNumber: index + 1,
    units,
    sourceWordCount: units.reduce(
      (count, unit) => count + Math.max(0, unit.entryCount),
      0,
    ),
  }));
}

export function applyTimeTemplate<T extends {
  schedule: VocabScheduleDraft;
  exam: ExamSettings;
}>(draft: T, template: VocabTimeTemplate): T {
  return {
    ...draft,
    schedule: {
      ...draft.schedule,
      availableTime: template.availableTime,
      deadlineDayOffset: template.deadlineDayOffset,
      deadlineTime: template.deadlineTime,
    },
    exam: {
      ...draft.exam,
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
      ? { ...slot, ...override }
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
