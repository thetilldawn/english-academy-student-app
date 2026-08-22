import type { ExamSettings, ExamTiming } from "./model";

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];
export type VocabAssignmentEntryMode = "student" | "school" | "dataset";
export type VocabRangeDistribution = "split" | "repeat";
export type VocabSplitBasis = "question_count" | "range_unit";
export type VocabUnitAllocationMode = "same" | "by_weekday";
export type VocabWeekdayUnitCounts = Readonly<Record<IsoWeekday, number>>;
export type CollisionDecisionMode = "skip" | "move" | "allow";
export type VocabQuestionCountChoice =
  | { mode: "all" }
  | { mode: "manual"; value: number };
export type VocabSplitOverflowPolicy = "leave" | "continue_weekly";
export type VocabExtraDatePolicy =
  | "unconfirmed"
  | "repeat_from_start";
export type VocabTargetSelectionMode = "source_order" | "random";
export type VocabTargetDirection =
  | "english_to_korean"
  | "korean_to_english";
export type VocabSeriesTarget = {
  id: number;
  eligibleDirections: readonly VocabTargetDirection[];
  conflictKeys?: Partial<
    Record<VocabTargetDirection, { promptKey: string; answerKey: string }>
  >;
};
export type PlannedVocabSeriesTarget = {
  id: number;
  direction: VocabTargetDirection;
};

export const MINIMUM_VOCAB_SESSION_QUESTION_COUNT = 4;
export const MAXIMUM_VOCAB_SESSION_QUESTION_COUNT = 500;

export type VocabQuestionAllocationIssue =
  | "invalid_available_count"
  | "invalid_question_count"
  | "missing_schedule"
  | "insufficient_for_selected_dates"
  | "question_count_exceeds_capacity"
  | "session_question_limit_exceeded"
  | "series_session_limit_exceeded";

export type VocabQuestionAllocation = {
  sessionQuestionCounts: number[];
  selectedQuestionCount: number;
  remainingQuestionCount: number;
  extraSessionCount: number;
  issue: VocabQuestionAllocationIssue | null;
};

export type VocabQuestionCycleAllocation = VocabQuestionAllocation & {
  baseSessionQuestionCounts: number[];
  defaultSessionCount: number;
  requiresExtraDateDecision: boolean;
  scheduledQuestionCount: number;
  sessionCycleIndexes: number[];
};

export type VocabUnitCycleAllocationIssue =
  | "missing_units"
  | "missing_schedule"
  | "invalid_unit_count"
  | "series_session_limit_exceeded";

export type VocabUnitCycleAllocation = {
  sessionUnitIds: string[][];
  remainingUnitIds: string[];
  defaultSessionCount: number;
  requiresExtraDateDecision: boolean;
  sessionCycleIndexes: number[];
  issue: VocabUnitCycleAllocationIssue | null;
};

export function resolveExtraDateCancelSessionCount(
  items: readonly {
    defaultSessionCount: number | null;
    requiresExtraDateDecision: boolean;
  }[],
  fallback: number,
) {
  const counts = items
    .filter((item) => item.requiresExtraDateDecision)
    .flatMap((item) => item.defaultSessionCount === null
      ? []
      : [item.defaultSessionCount]);
  return counts.length > 0 ? Math.min(...counts) : fallback;
}

export type DayRangeSelection = {
  startUnitId: string | null;
  endUnitId: string | null;
};

export type VocabScheduleDraft = {
  startDate: string;
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
  timeLimitEnabled?: boolean;
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

function emptyQuestionAllocation(
  issue: VocabQuestionAllocationIssue,
): VocabQuestionAllocation {
  return {
    sessionQuestionCounts: [],
    selectedQuestionCount: 0,
    remainingQuestionCount: 0,
    extraSessionCount: 0,
    issue,
  };
}

function balancedQuestionCounts(total: number, sessionCount: number) {
  const quotient = Math.floor(total / sessionCount);
  const remainder = total % sessionCount;
  return Array.from(
    { length: sessionCount },
    (_, index) => quotient + (index < remainder ? 1 : 0),
  );
}

/**
 * A 50% quiz rounds every odd session toward English. Keep at most one odd
 * session so the sum of the per-session quotas still matches the whole pool.
 */
export function rebalanceHalfRatioSplitQuestionCounts(
  counts: readonly number[],
  maximumQuestionCount: number,
) {
  if (
    !Number.isInteger(maximumQuestionCount) ||
    maximumQuestionCount < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
    counts.length === 0 ||
    counts.some(
      (count) =>
        !Number.isInteger(count) ||
        count < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
        count > maximumQuestionCount,
    )
  ) {
    return null;
  }
  const total = counts.reduce((sum, count) => sum + count, 0);
  const targetOddCount = total % 2;
  const oddIndexCandidates: Array<number | null> = targetOddCount === 0
    ? [null]
    : counts.map((_count, index) => index);
  let best: number[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestMaximumChange = Number.POSITIVE_INFINITY;

  for (const oddIndex of oddIndexCandidates) {
    const candidate: number[] = [];
    let valid = true;
    for (const [index, count] of counts.entries()) {
      const parity = index === oddIndex ? 1 : 0;
      const minimum = parity === 1 ? 5 : 4;
      if (minimum > maximumQuestionCount) {
        valid = false;
        break;
      }
      if (count % 2 === parity) {
        candidate.push(count);
        continue;
      }
      const lower = count - 1;
      const upper = count + 1;
      if (lower >= minimum) candidate.push(lower);
      else if (upper <= maximumQuestionCount) candidate.push(upper);
      else {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    let difference = total - candidate.reduce((sum, count) => sum + count, 0);
    if (difference % 2 !== 0) continue;
    while (difference !== 0) {
      const step = difference > 0 ? 2 : -2;
      const movable = candidate.flatMap((count, index) => {
        const moved = count + step;
        const minimum = index === oddIndex ? 5 : 4;
        if (moved < minimum || moved > maximumQuestionCount) return [];
        return [{
          index,
          marginalCost:
            Math.abs(moved - counts[index]!) -
            Math.abs(count - counts[index]!),
        }];
      }).toSorted((left, right) =>
        left.marginalCost - right.marginalCost ||
        (step > 0 ? right.index - left.index : left.index - right.index)
      );
      const selected = movable[0];
      if (!selected) {
        valid = false;
        break;
      }
      candidate[selected.index] = candidate[selected.index]! + step;
      difference -= step;
    }
    if (!valid) continue;

    const changes = candidate.map((count, index) =>
      Math.abs(count - counts[index]!)
    );
    const cost = changes.reduce((sum, change) => sum + change, 0);
    const maximumChange = Math.max(...changes);
    let lexicographicallyEarlier = best === null;
    if (best) {
      for (const [index, count] of candidate.entries()) {
        if (count === best[index]) continue;
        lexicographicallyEarlier = count < best[index]!;
        break;
      }
    }
    if (
      cost < bestCost ||
      (cost === bestCost && maximumChange < bestMaximumChange) ||
      (cost === bestCost &&
        maximumChange === bestMaximumChange &&
        lexicographicallyEarlier)
    ) {
      best = candidate;
      bestCost = cost;
      bestMaximumChange = maximumChange;
    }
  }
  return best;
}

function allocationResult(input: {
  availableQuestionCount: number;
  baseSessionCount: number;
  sessionQuestionCounts: number[];
  selectedQuestionCount: number;
}): VocabQuestionAllocation {
  return {
    sessionQuestionCounts: input.sessionQuestionCounts,
    selectedQuestionCount: input.selectedQuestionCount,
    remainingQuestionCount: Math.max(
      0,
      input.availableQuestionCount - input.selectedQuestionCount,
    ),
    extraSessionCount: Math.max(
      0,
      input.sessionQuestionCounts.length - input.baseSessionCount,
    ),
    issue: null,
  };
}

export function splitVocabTargetPoolPreparationCounts(
  totalQuestionCount: number,
): number[] {
  const minimum = MINIMUM_VOCAB_SESSION_QUESTION_COUNT;
  const maximum = MAXIMUM_VOCAB_SESSION_QUESTION_COUNT;
  if (!Number.isInteger(totalQuestionCount) || totalQuestionCount < minimum) {
    return [];
  }
  const counts: number[] = [];
  let remaining = totalQuestionCount;
  while (remaining > maximum) {
    let current = maximum;
    const tail = remaining - current;
    if (tail < minimum) current -= minimum - tail;
    counts.push(current);
    remaining -= current;
  }
  counts.push(remaining);
  return counts;
}

function splitManualVocabQuestionCounts(
  totalQuestionCount: number,
  maximumQuestionCount: number,
) {
  const minimum = MINIMUM_VOCAB_SESSION_QUESTION_COUNT;
  if (
    !Number.isInteger(totalQuestionCount) ||
    totalQuestionCount < minimum ||
    !Number.isInteger(maximumQuestionCount) ||
    maximumQuestionCount < minimum ||
    maximumQuestionCount > MAXIMUM_VOCAB_SESSION_QUESTION_COUNT
  ) {
    return [];
  }
  const counts: number[] = [];
  let remaining = totalQuestionCount;
  while (remaining > maximumQuestionCount) {
    let current = maximumQuestionCount;
    const tail = remaining - current;
    if (tail < minimum) current -= minimum - tail;
    if (current < minimum) return [];
    counts.push(current);
    remaining -= current;
  }
  if (remaining < minimum) return [];
  counts.push(remaining);
  return counts;
}

/**
 * Calculates the question cycle before calendar dates are applied. Weekdays
 * place the calculated sessions; they do not decide how the range is split.
 */
export function resolveVocabQuestionCycleAllocation(input: {
  availableQuestionCount: number;
  distribution: VocabRangeDistribution;
  questionCount: VocabQuestionCountChoice;
  selectedDateCount: number;
  extraDatePolicy: VocabExtraDatePolicy;
  maximumSessionCount?: number;
}): VocabQuestionCycleAllocation {
  const minimum = MINIMUM_VOCAB_SESSION_QUESTION_COUNT;
  const maximum = MAXIMUM_VOCAB_SESSION_QUESTION_COUNT;
  const maximumSessionCount = input.maximumSessionCount ?? 210;
  const empty = (
    issue: VocabQuestionAllocationIssue,
  ): VocabQuestionCycleAllocation => ({
    ...emptyQuestionAllocation(issue),
    baseSessionQuestionCounts: [],
    defaultSessionCount: 0,
    requiresExtraDateDecision: false,
    scheduledQuestionCount: 0,
    sessionCycleIndexes: [],
  });
  if (
    !Number.isInteger(input.availableQuestionCount) ||
    input.availableQuestionCount < minimum
  ) {
    return empty("invalid_available_count");
  }
  if (
    !Number.isInteger(input.selectedDateCount) ||
    input.selectedDateCount < 0
  ) {
    return empty("missing_schedule");
  }
  const manualCount = input.questionCount.mode === "manual"
    ? input.questionCount.value
    : null;
  if (
    manualCount !== null &&
    (!Number.isInteger(manualCount) ||
      manualCount < minimum ||
      manualCount > maximum)
  ) {
    return empty("invalid_question_count");
  }

  if (input.distribution === "repeat") {
    const perSessionCount = manualCount ?? input.availableQuestionCount;
    if (perSessionCount > input.availableQuestionCount) {
      return empty("question_count_exceeds_capacity");
    }
    if (perSessionCount > maximum) {
      return empty("session_question_limit_exceeded");
    }
    const sessionCount = Math.max(1, input.selectedDateCount);
    if (sessionCount > maximumSessionCount) {
      return empty("series_session_limit_exceeded");
    }
    const counts = Array.from({ length: sessionCount }, () => perSessionCount);
    return {
      ...allocationResult({
        availableQuestionCount: input.availableQuestionCount,
        baseSessionCount: sessionCount,
        sessionQuestionCounts: counts,
        selectedQuestionCount: perSessionCount,
      }),
      baseSessionQuestionCounts: [perSessionCount],
      defaultSessionCount: 1,
      requiresExtraDateDecision: false,
      scheduledQuestionCount: counts.reduce((sum, count) => sum + count, 0),
      sessionCycleIndexes: counts.map((_count, index) => index),
    };
  }

  const baseCounts = manualCount === null
    ? splitVocabTargetPoolPreparationCounts(input.availableQuestionCount)
    : splitManualVocabQuestionCounts(
        input.availableQuestionCount,
        manualCount,
      );
  if (baseCounts.length === 0) {
    return empty("insufficient_for_selected_dates");
  }
  const requiresExtraDateDecision =
    input.selectedDateCount > baseCounts.length &&
    input.extraDatePolicy === "unconfirmed";
  const shouldRepeat =
    input.selectedDateCount > baseCounts.length &&
    input.extraDatePolicy === "repeat_from_start";
  const sessionCount = shouldRepeat
    ? input.selectedDateCount
    : baseCounts.length;
  if (sessionCount > maximumSessionCount) {
    return empty("series_session_limit_exceeded");
  }
  const sessionQuestionCounts = shouldRepeat
    ? Array.from(
        { length: sessionCount },
        (_value, index) => baseCounts[index % baseCounts.length]!,
      )
    : [...baseCounts];
  const scheduledQuestionCount = sessionQuestionCounts.reduce(
    (sum, count) => sum + count,
    0,
  );
  return {
    ...allocationResult({
      availableQuestionCount: input.availableQuestionCount,
      baseSessionCount: Math.max(1, input.selectedDateCount),
      sessionQuestionCounts,
      selectedQuestionCount: scheduledQuestionCount,
    }),
    baseSessionQuestionCounts: [...baseCounts],
    defaultSessionCount: baseCounts.length,
    requiresExtraDateDecision,
    scheduledQuestionCount,
    sessionCycleIndexes: sessionQuestionCounts.map(
      (_count, index) => Math.floor(index / baseCounts.length),
    ),
  };
}

/**
 * Splits only the already selected, ordered range. Calendar slots provide the
 * repeating per-session unit counts but never expand the selected range.
 */
export function resolveVocabUnitCycleAllocation(input: {
  orderedUnitIds: readonly string[];
  baseSessionUnitCounts: readonly number[];
  selectedDateCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  extraDatePolicy: VocabExtraDatePolicy;
  maximumSessionCount?: number;
}): VocabUnitCycleAllocation {
  const maximumSessionCount = input.maximumSessionCount ?? 210;
  const empty = (
    issue: VocabUnitCycleAllocationIssue,
  ): VocabUnitCycleAllocation => ({
    sessionUnitIds: [],
    remainingUnitIds: [],
    defaultSessionCount: 0,
    requiresExtraDateDecision: false,
    sessionCycleIndexes: [],
    issue,
  });
  if (
    input.orderedUnitIds.length === 0 ||
    new Set(input.orderedUnitIds).size !== input.orderedUnitIds.length
  ) {
    return empty("missing_units");
  }
  if (
    !Number.isInteger(input.selectedDateCount) ||
    input.selectedDateCount < 1 ||
    input.baseSessionUnitCounts.length !== input.selectedDateCount
  ) {
    return empty("missing_schedule");
  }
  if (
    input.baseSessionUnitCounts.some(
      (count) => !Number.isInteger(count) || count < 1 || count > 30,
    )
  ) {
    return empty("invalid_unit_count");
  }

  let firstCycleCursor = 0;
  let defaultSessionCount = 0;
  while (firstCycleCursor < input.orderedUnitIds.length) {
    const count = input.baseSessionUnitCounts[
      defaultSessionCount % input.baseSessionUnitCounts.length
    ]!;
    firstCycleCursor += input.orderedUnitIds.slice(
      firstCycleCursor,
      firstCycleCursor + count,
    ).length;
    defaultSessionCount += 1;
  }
  const requiresExtraDateDecision =
    input.selectedDateCount > defaultSessionCount &&
    input.extraDatePolicy === "unconfirmed";
  const repeatFromStart =
    input.selectedDateCount > defaultSessionCount &&
    input.extraDatePolicy === "repeat_from_start";
  const requiredSessionCount = repeatFromStart
    ? input.selectedDateCount
    : (
    input.overflowPolicy === "continue_weekly" &&
    defaultSessionCount > input.selectedDateCount
      ? defaultSessionCount
      : Math.min(defaultSessionCount, input.selectedDateCount)
    );
  if (requiredSessionCount > maximumSessionCount) {
    return empty("series_session_limit_exceeded");
  }

  const sessionUnitIds: string[][] = [];
  const sessionCycleIndexes: number[] = [];
  let cursor = 0;
  let cycleIndex = 0;
  for (let index = 0; index < requiredSessionCount; index += 1) {
    const count = input.baseSessionUnitCounts[
      index % input.baseSessionUnitCounts.length
    ]!;
    const chunk = input.orderedUnitIds.slice(cursor, cursor + count);
    sessionUnitIds.push([...chunk]);
    sessionCycleIndexes.push(cycleIndex);
    cursor += chunk.length;
    if (cursor === input.orderedUnitIds.length && index + 1 < requiredSessionCount) {
      cursor = 0;
      cycleIndex += 1;
    }
  }
  return {
    sessionUnitIds,
    remainingUnitIds: repeatFromStart || cursor === 0
      ? []
      : input.orderedUnitIds.slice(cursor),
    defaultSessionCount,
    requiresExtraDateDecision,
    sessionCycleIndexes,
    issue: null,
  };
}

/**
 * Converts one student's actual eligible question capacity into the concrete
 * question count for each scheduled quiz. It does not inspect DAY row counts.
 */
export function resolveVocabQuestionAllocation(input: {
  availableQuestionCount: number;
  distribution: VocabRangeDistribution;
  questionCount: VocabQuestionCountChoice;
  baseSessionCount: number;
  overflowPolicy: VocabSplitOverflowPolicy;
  maximumSessionCount?: number;
}): VocabQuestionAllocation {
  const minimum = MINIMUM_VOCAB_SESSION_QUESTION_COUNT;
  const maximum = MAXIMUM_VOCAB_SESSION_QUESTION_COUNT;
  const maximumSessionCount = input.maximumSessionCount ?? 210;
  if (
    !Number.isInteger(input.availableQuestionCount) ||
    input.availableQuestionCount < minimum
  ) {
    return emptyQuestionAllocation("invalid_available_count");
  }
  if (
    !Number.isInteger(input.baseSessionCount) ||
    input.baseSessionCount < 1
  ) {
    return emptyQuestionAllocation("missing_schedule");
  }
  if (
    !Number.isInteger(maximumSessionCount) ||
    maximumSessionCount < input.baseSessionCount
  ) {
    return emptyQuestionAllocation("series_session_limit_exceeded");
  }

  const manualCount = input.questionCount.mode === "manual"
    ? input.questionCount.value
    : null;
  if (
    manualCount !== null &&
    (!Number.isInteger(manualCount) ||
      manualCount < minimum ||
      manualCount > maximum)
  ) {
    return emptyQuestionAllocation("invalid_question_count");
  }

  if (input.distribution === "repeat") {
    const perSessionCount = manualCount ?? input.availableQuestionCount;
    if (perSessionCount > input.availableQuestionCount) {
      return emptyQuestionAllocation("question_count_exceeds_capacity");
    }
    if (perSessionCount > maximum) {
      return emptyQuestionAllocation("session_question_limit_exceeded");
    }
    return allocationResult({
      availableQuestionCount: input.availableQuestionCount,
      baseSessionCount: input.baseSessionCount,
      sessionQuestionCounts: Array.from(
        { length: input.baseSessionCount },
        () => perSessionCount,
      ),
      selectedQuestionCount: perSessionCount,
    });
  }

  if (input.availableQuestionCount < input.baseSessionCount * minimum) {
    return emptyQuestionAllocation("insufficient_for_selected_dates");
  }

  if (manualCount === null) {
    const counts = balancedQuestionCounts(
      input.availableQuestionCount,
      input.baseSessionCount,
    );
    if (counts.some((count) => count > maximum)) {
      return emptyQuestionAllocation("session_question_limit_exceeded");
    }
    return allocationResult({
      availableQuestionCount: input.availableQuestionCount,
      baseSessionCount: input.baseSessionCount,
      sessionQuestionCounts: counts,
      selectedQuestionCount: input.availableQuestionCount,
    });
  }

  const initialCapacity = manualCount * input.baseSessionCount;
  if (
    input.overflowPolicy === "leave" ||
    input.availableQuestionCount <= initialCapacity
  ) {
    const selectedQuestionCount = Math.min(
      input.availableQuestionCount,
      initialCapacity,
    );
    let unallocatedQuestionCount = selectedQuestionCount;
    const sessionQuestionCounts = Array.from(
      { length: input.baseSessionCount },
      (_, index) => {
        const remainingSessionCount = input.baseSessionCount - index - 1;
        const count = Math.min(
          manualCount,
          unallocatedQuestionCount - remainingSessionCount * minimum,
        );
        unallocatedQuestionCount -= count;
        return count;
      },
    );
    return allocationResult({
      availableQuestionCount: input.availableQuestionCount,
      baseSessionCount: input.baseSessionCount,
      sessionQuestionCounts,
      selectedQuestionCount,
    });
  }

  const counts = Array.from(
    { length: input.baseSessionCount },
    () => manualCount,
  );
  let remaining = input.availableQuestionCount - initialCapacity;
  while (remaining >= manualCount) {
    counts.push(manualCount);
    remaining -= manualCount;
  }
  if (remaining >= minimum) {
    counts.push(remaining);
  } else if (remaining > 0) {
    const previousIndex = counts.length - 1;
    const amountToMove = minimum - remaining;
    if ((counts[previousIndex] ?? 0) - amountToMove < minimum) {
      return emptyQuestionAllocation("insufficient_for_selected_dates");
    }
    counts[previousIndex] = counts[previousIndex]! - amountToMove;
    counts.push(minimum);
  }
  if (counts.length > maximumSessionCount) {
    return emptyQuestionAllocation("series_session_limit_exceeded");
  }
  return allocationResult({
    availableQuestionCount: input.availableQuestionCount,
    baseSessionCount: input.baseSessionCount,
    sessionQuestionCounts: counts,
    selectedQuestionCount: input.availableQuestionCount,
  });
}

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
  if (
    !TIME_PATTERN.test(draft.availableTime) ||
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
      availableLocalDateTime: `${date}T${draft.availableTime}`,
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
  return input.slots.map((slot) => {
    if (input.mode === "same") return input.unitsPerSession;
    const date = parseCalendarDate(slot.date);
    if (!date) return Number.NaN;
    return input.weekdayUnitsPerSession[isoWeekday(date)];
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

function seededRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0;
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffledIds(ids: readonly number[], seed: string) {
  const result = [...ids];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [
      result[swapIndex]!,
      result[index]!,
    ];
  }
  return result;
}

/**
 * Pure target-identity contract used to test non-overlap and seed stability.
 * The server still validates direction and distractor eligibility before save.
 */
export function planVocabSeriesTargetIds(input: {
  candidateIds: readonly number[];
  distribution: VocabRangeDistribution;
  selectionMode: VocabTargetSelectionMode;
  sessionQuestionCounts: readonly number[];
  seedScope: string;
}): number[][] {
  const uniqueIds = new Set(input.candidateIds);
  if (
    uniqueIds.size !== input.candidateIds.length ||
    input.candidateIds.length < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
    !input.seedScope.trim() ||
    input.sessionQuestionCounts.some(
      (count) =>
        !Number.isInteger(count) ||
        count < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
        count > input.candidateIds.length,
    )
  ) {
    return [];
  }

  const orderedCycle = (cycle: number) =>
    input.selectionMode === "source_order"
      ? [...input.candidateIds]
      : shuffledIds(input.candidateIds, `${input.seedScope}:${cycle}`);

  if (input.distribution === "split") {
    const total = input.sessionQuestionCounts.reduce(
      (sum, count) => sum + count,
      0,
    );
    if (total > input.candidateIds.length) return [];
    const queue = orderedCycle(0);
    let cursor = 0;
    return input.sessionQuestionCounts.map((count) => {
      const selected = queue.slice(cursor, cursor + count);
      cursor += count;
      return selected;
    });
  }

  if (input.selectionMode === "source_order") {
    return input.sessionQuestionCounts.map((count) =>
      input.candidateIds.slice(0, count)
    );
  }

  let cycle = 0;
  let queue = orderedCycle(cycle);
  return input.sessionQuestionCounts.map((count) => {
    const selected: number[] = [];
    while (selected.length < count) {
      const needed = count - selected.length;
      const available = queue.filter((id) => !selected.includes(id));
      selected.push(...available.slice(0, needed));
      queue = queue.slice(available.slice(0, needed).length);
      if (selected.length < count) {
        cycle += 1;
        queue = orderedCycle(cycle).filter((id) => !selected.includes(id));
      }
    }
    return selected;
  });
}

function englishQuestionCount(
  questionCount: number,
  ratio: 0 | 50 | 100,
) {
  return Math.round(questionCount * (ratio / 100));
}

function takeFromRandomDirectionCycle(input: {
  pool: readonly number[];
  count: number;
  seedScope: string;
  direction: VocabTargetDirection;
  state: { cycle: number; queue: number[] };
}) {
  const selected: number[] = [];
  const selectedIds = new Set<number>();
  while (selected.length < input.count) {
    const candidateIndex = input.state.queue.findIndex(
      (id) => !selectedIds.has(id),
    );
    if (candidateIndex >= 0) {
      const [id] = input.state.queue.splice(candidateIndex, 1);
      if (id !== undefined) {
        selected.push(id);
        selectedIds.add(id);
      }
      continue;
    }
    input.state.cycle += 1;
    input.state.queue = shuffledIds(
      input.pool,
      `${input.seedScope}:${input.direction}:${input.state.cycle}`,
    );
  }
  return selected;
}

type VocabTargetDirectionClass = "english" | "korean" | "both";

function targetDirectionClass(
  candidate: VocabSeriesTarget,
): VocabTargetDirectionClass | null {
  const english = candidate.eligibleDirections.includes("english_to_korean");
  const korean = candidate.eligibleDirections.includes("korean_to_english");
  if (english && korean) return "both";
  if (english) return "english";
  if (korean) return "korean";
  return null;
}

function canCompleteDirectionalTargetSelection(input: {
  fixed: Record<VocabTargetDirectionClass, number>;
  available: Record<VocabTargetDirectionClass, number>;
  targetCount: number;
  englishCount: number;
  koreanCount: number;
}) {
  const fixedCount = input.fixed.english + input.fixed.korean + input.fixed.both;
  if (
    fixedCount > input.targetCount ||
    input.fixed.english > input.englishCount ||
    input.fixed.korean > input.koreanCount
  ) {
    return false;
  }
  const minimumEnglishOnly = input.fixed.english;
  const maximumEnglishOnly = Math.min(
    input.englishCount,
    input.fixed.english + input.available.english,
  );
  const minimumKoreanOnly = input.fixed.korean;
  const maximumKoreanOnly = Math.min(
    input.koreanCount,
    input.fixed.korean + input.available.korean,
  );
  const minimumEnglishAndKorean =
    input.targetCount - (input.fixed.both + input.available.both);
  const maximumEnglishAndKorean = input.targetCount - input.fixed.both;
  return (
    minimumEnglishOnly + minimumKoreanOnly <= maximumEnglishAndKorean &&
    maximumEnglishOnly + maximumKoreanOnly >= minimumEnglishAndKorean
  );
}

function selectDirectionalTargetPool(input: {
  candidates: readonly VocabSeriesTarget[];
  targetCount: number;
  englishCount: number;
  koreanCount: number;
}) {
  if (
    input.targetCount !== input.englishCount + input.koreanCount ||
    input.targetCount > input.candidates.length
  ) {
    return [];
  }
  const classified = input.candidates.map((candidate) => ({
    candidate,
    direction: targetDirectionClass(candidate),
  }));
  if (classified.some((item) => item.direction === null)) return [];
  const suffixCounts = Array.from(
    { length: classified.length + 1 },
    () => ({ english: 0, korean: 0, both: 0 }),
  );
  for (let index = classified.length - 1; index >= 0; index -= 1) {
    const current = { ...suffixCounts[index + 1]! };
    current[classified[index]!.direction!] += 1;
    suffixCounts[index] = current;
  }
  const fixed = { english: 0, korean: 0, both: 0 };
  const selected: VocabSeriesTarget[] = [];
  for (const [index, item] of classified.entries()) {
    if (selected.length === input.targetCount) break;
    const tentative = { ...fixed };
    tentative[item.direction!] += 1;
    if (!canCompleteDirectionalTargetSelection({
      fixed: tentative,
      available: suffixCounts[index + 1]!,
      targetCount: input.targetCount,
      englishCount: input.englishCount,
      koreanCount: input.koreanCount,
    })) {
      continue;
    }
    selected.push(item.candidate);
    fixed[item.direction!] += 1;
  }
  return selected.length === input.targetCount ? selected : [];
}

function targetConflictKey(
  candidate: VocabSeriesTarget,
  direction: VocabTargetDirection,
) {
  return candidate.conflictKeys?.[direction] ?? {
    promptKey: `${direction}:prompt:${candidate.id}`,
    answerKey: `${direction}:answer:${candidate.id}`,
  };
}

function hasPotentialSeriesPromptConflict(
  candidates: readonly VocabSeriesTarget[],
) {
  for (const direction of [
    "english_to_korean",
    "korean_to_english",
  ] as const) {
    const answersByPrompt = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      if (!candidate.eligibleDirections.includes(direction)) continue;
      const { promptKey, answerKey } = targetConflictKey(candidate, direction);
      const answers = answersByPrompt.get(promptKey) ?? new Set<string>();
      answers.add(answerKey);
      if (answers.size > 1) return true;
      answersByPrompt.set(promptKey, answers);
    }
  }
  return false;
}

function seriesDirectionCompatibility(input: {
  candidates: readonly VocabSeriesTarget[];
  direction: VocabTargetDirection;
}) {
  const answerCountsByPrompt = new Map<string, Map<string, number>>();
  for (const candidate of input.candidates) {
    if (!candidate.eligibleDirections.includes(input.direction)) continue;
    const { promptKey, answerKey } = targetConflictKey(
      candidate,
      input.direction,
    );
    const answerCounts = answerCountsByPrompt.get(promptKey) ?? new Map();
    answerCounts.set(answerKey, (answerCounts.get(answerKey) ?? 0) + 1);
    answerCountsByPrompt.set(promptKey, answerCounts);
  }
  const maximumByPrompt = new Map<string, number>();
  let maximumCount = 0;
  for (const [promptKey, answerCounts] of answerCountsByPrompt) {
    const promptMaximum = Math.max(0, ...answerCounts.values());
    maximumByPrompt.set(promptKey, promptMaximum);
    maximumCount += promptMaximum;
  }
  return { answerCountsByPrompt, maximumByPrompt, maximumCount };
}

/** Remove a direction variant that cannot participate in even the smallest
 * scheduled paper. For example, if a 4-question E paper has only two other
 * prompts, a one-word answer variant can never coexist with enough targets.
 */
function pruneNeverFeasibleSeriesDirections(input: {
  candidates: readonly VocabSeriesTarget[];
  englishNeeds: readonly number[];
  koreanNeeds: readonly number[];
}) {
  const needs = {
    english_to_korean: input.englishNeeds,
    korean_to_english: input.koreanNeeds,
  } as const;
  const compatibility = {
    english_to_korean: seriesDirectionCompatibility({
      candidates: input.candidates,
      direction: "english_to_korean",
    }),
    korean_to_english: seriesDirectionCompatibility({
      candidates: input.candidates,
      direction: "korean_to_english",
    }),
  } as const;
  for (const direction of [
    "english_to_korean",
    "korean_to_english",
  ] as const) {
    const maximumNeed = Math.max(...needs[direction]);
    if (maximumNeed > compatibility[direction].maximumCount) return [];
  }

  return input.candidates.flatMap((candidate) => {
    const eligibleDirections = candidate.eligibleDirections.filter((direction) => {
      const positiveNeeds = needs[direction].filter((count) => count > 0);
      if (positiveNeeds.length === 0) return false;
      const minimumNeed = Math.min(...positiveNeeds);
      const { promptKey, answerKey } = targetConflictKey(candidate, direction);
      const directionCompatibility = compatibility[direction];
      const answerCount = directionCompatibility.answerCountsByPrompt
        .get(promptKey)?.get(answerKey) ?? 0;
      const otherPromptCount = directionCompatibility.maximumCount -
        (directionCompatibility.maximumByPrompt.get(promptKey) ?? 0);
      return answerCount + otherPromptCount >= minimumNeed;
    });
    return eligibleDirections.length === 0
      ? []
      : [{ ...candidate, eligibleDirections }];
  });
}

function seriesDirectionNeed(
  direction: VocabTargetDirection,
  sessionIndex: number,
  englishNeeds: readonly number[],
  koreanNeeds: readonly number[],
) {
  return direction === "english_to_korean"
    ? englishNeeds[sessionIndex]!
    : koreanNeeds[sessionIndex]!;
}

function seriesDirectionCount(
  session: readonly PlannedVocabSeriesTarget[],
  direction: VocabTargetDirection,
) {
  return session.filter((target) => target.direction === direction).length;
}

function canPlaceSeriesTarget(input: {
  candidate: VocabSeriesTarget;
  direction: VocabTargetDirection;
  session: readonly PlannedVocabSeriesTarget[];
  candidateById: ReadonlyMap<number, VocabSeriesTarget>;
  excludedIndex?: number;
}) {
  const candidateKey = targetConflictKey(input.candidate, input.direction);
  return input.session.every((target, index) => {
    if (index === input.excludedIndex) return true;
    if (target.id === input.candidate.id) return false;
    if (target.direction !== input.direction) return true;
    const existing = input.candidateById.get(target.id);
    if (!existing) return false;
    const existingKey = targetConflictKey(existing, input.direction);
    return existingKey.promptKey !== candidateKey.promptKey ||
      existingKey.answerKey === candidateKey.answerKey;
  });
}

function seriesTargetOccurrenceCount(
  plan: readonly (readonly PlannedVocabSeriesTarget[])[],
  candidateId: number,
) {
  return plan.reduce(
    (count, session) =>
      count + session.filter((target) => target.id === candidateId).length,
    0,
  );
}

function tryAugmentSeriesPlan(input: {
  plan: readonly (readonly PlannedVocabSeriesTarget[])[];
  candidate: VocabSeriesTarget;
  candidateById: ReadonlyMap<number, VocabSeriesTarget>;
  englishNeeds: readonly number[];
  koreanNeeds: readonly number[];
  allowDroppingRepeatedTarget: boolean;
  path?: ReadonlySet<string>;
  depth?: number;
  budget?: { remaining: number };
}): PlannedVocabSeriesTarget[][] | null {
  const depth = input.depth ?? 0;
  const budget = input.budget ?? { remaining: 30_000 };
  if (depth > 64 || budget.remaining < 1) return null;
  budget.remaining -= 1;
  const path = input.path ?? new Set<string>();
  const directions = [...input.candidate.eligibleDirections].toSorted(
    (left, right) => {
      const freeSlots = (direction: VocabTargetDirection) =>
        input.plan.reduce((count, session, sessionIndex) =>
          count + Number(
            seriesDirectionCount(session, direction) <
              seriesDirectionNeed(
                direction,
                sessionIndex,
                input.englishNeeds,
                input.koreanNeeds,
              ),
          ), 0);
      return freeSlots(right) - freeSlots(left) ||
        left.localeCompare(right);
    },
  );

  for (const direction of directions) {
    const sessionIndexes = input.plan.map((_session, index) => index).toSorted(
      (left, right) => {
        const leftFree = seriesDirectionCount(input.plan[left]!, direction) <
          seriesDirectionNeed(
            direction,
            left,
            input.englishNeeds,
            input.koreanNeeds,
          );
        const rightFree = seriesDirectionCount(input.plan[right]!, direction) <
          seriesDirectionNeed(
            direction,
            right,
            input.englishNeeds,
            input.koreanNeeds,
          );
        return Number(rightFree) - Number(leftFree) || left - right;
      },
    );
    for (const sessionIndex of sessionIndexes) {
      const required = seriesDirectionNeed(
        direction,
        sessionIndex,
        input.englishNeeds,
        input.koreanNeeds,
      );
      if (required < 1) continue;
      const session = input.plan[sessionIndex]!;
      const currentCount = seriesDirectionCount(session, direction);
      if (
        currentCount < required &&
        canPlaceSeriesTarget({
          candidate: input.candidate,
          direction,
          session,
          candidateById: input.candidateById,
        })
      ) {
        const next = input.plan.map((targets) => [...targets]);
        next[sessionIndex]!.push({ id: input.candidate.id, direction });
        return next;
      }
      // A partially filled session can still need an exchange: the incoming
      // candidate may conflict with one existing sense even though a slot is
      // open. Move that conflicting target elsewhere, then use the open slot
      // on a later recursion step.
      if (currentCount > required) continue;

      for (const [targetIndex, target] of session.entries()) {
        if (target.direction !== direction) continue;
        const moveKey = `${input.candidate.id}:${direction}:${sessionIndex}:${target.id}`;
        if (path.has(moveKey)) continue;
        if (!canPlaceSeriesTarget({
          candidate: input.candidate,
          direction,
          session,
          candidateById: input.candidateById,
          excludedIndex: targetIndex,
        })) {
          continue;
        }
        const displaced = input.candidateById.get(target.id);
        if (!displaced) continue;
        const next = input.plan.map((targets) => [...targets]);
        next[sessionIndex]![targetIndex] = {
          id: input.candidate.id,
          direction,
        };
        if (
          input.allowDroppingRepeatedTarget &&
          seriesTargetOccurrenceCount(next, displaced.id) > 0
        ) {
          return next;
        }
        const nextPath = new Set(path);
        nextPath.add(moveKey);
        const augmented = tryAugmentSeriesPlan({
          ...input,
          plan: next,
          candidate: displaced,
          path: nextPath,
          depth: depth + 1,
          budget,
        });
        if (augmented) return augmented;
      }
    }
  }
  return null;
}

function completeConflictAwareSeriesPlan(input: {
  plan: readonly (readonly PlannedVocabSeriesTarget[])[];
  candidates: readonly VocabSeriesTarget[];
  distribution: VocabRangeDistribution;
  selectionMode: VocabTargetSelectionMode;
  englishNeeds: readonly number[];
  koreanNeeds: readonly number[];
}) {
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const requiredCount = input.englishNeeds.reduce(
    (total, count, index) => total + count + input.koreanNeeds[index]!,
    0,
  );
  let plan = input.plan.map((session) => [...session]);
  while (plan.reduce((total, session) => total + session.length, 0) < requiredCount) {
    const candidates = [...input.candidates].toSorted((left, right) =>
      seriesTargetOccurrenceCount(plan, left.id) -
        seriesTargetOccurrenceCount(plan, right.id)
    );
    let nextPlan: PlannedVocabSeriesTarget[][] | null = null;
    const budget = { remaining: 100_000 };
    for (const candidate of candidates) {
      const occurrences = seriesTargetOccurrenceCount(plan, candidate.id);
      if (input.distribution === "split" && occurrences > 0) continue;
      nextPlan = tryAugmentSeriesPlan({
        plan,
        candidate,
        candidateById,
        englishNeeds: input.englishNeeds,
        koreanNeeds: input.koreanNeeds,
        allowDroppingRepeatedTarget: false,
        budget,
      });
      if (nextPlan) break;
    }
    if (!nextPlan) return null;
    plan = nextPlan;
  }

  if (
    input.distribution === "repeat" &&
    input.selectionMode === "random"
  ) {
    for (;;) {
      const unused = input.candidates.filter(
        (candidate) => seriesTargetOccurrenceCount(plan, candidate.id) === 0,
      );
      let improved: PlannedVocabSeriesTarget[][] | null = null;
      const budget = { remaining: 100_000 };
      for (const candidate of unused) {
        improved = tryAugmentSeriesPlan({
          plan,
          candidate,
          candidateById,
          englishNeeds: input.englishNeeds,
          koreanNeeds: input.koreanNeeds,
          allowDroppingRepeatedTarget: true,
          budget,
        });
        if (improved) break;
      }
      if (!improved) break;
      plan = improved;
    }
  }

  const valid = plan.every((session, sessionIndex) =>
    seriesDirectionCount(session, "english_to_korean") ===
      input.englishNeeds[sessionIndex] &&
    seriesDirectionCount(session, "korean_to_english") ===
      input.koreanNeeds[sessionIndex] &&
    new Set(session.map((target) => target.id)).size === session.length &&
    session.every((target, targetIndex) => {
      const candidate = candidateById.get(target.id);
      return Boolean(candidate) && canPlaceSeriesTarget({
        candidate: candidate!,
        direction: target.direction,
        session,
        candidateById,
        excludedIndex: targetIndex,
      });
    })
  );
  if (
    !valid ||
    (input.distribution === "split" &&
      new Set(plan.flatMap((session) => session.map((target) => target.id))).size !==
        requiredCount)
  ) {
    return null;
  }
  return plan;
}

/**
 * Conflict groups are normally sparse and the augmenting planner handles the
 * large data path. For a small ambiguous set, search the complete combination
 * space so a locally attractive sense cannot hide a valid series or reduce the
 * number of distinct words used by random repeat.
 */
function searchSmallConflictAwareSeriesPlan(input: {
  candidates: readonly VocabSeriesTarget[];
  distribution: VocabRangeDistribution;
  selectionMode: VocabTargetSelectionMode;
  englishNeeds: readonly number[];
  koreanNeeds: readonly number[];
}): PlannedVocabSeriesTarget[][] | null {
  const requiredCount = input.englishNeeds.reduce(
    (total, count, index) => total + count + input.koreanNeeds[index]!,
    0,
  );
  if (
    input.candidates.length > 24 ||
    (input.distribution === "split" && requiredCount > input.candidates.length) ||
    (input.distribution === "repeat" && input.selectionMode !== "random")
  ) {
    return null;
  }

  if (
    Math.max(...input.englishNeeds) >
      seriesDirectionCompatibility({
        candidates: input.candidates,
        direction: "english_to_korean",
      }).maximumCount ||
    Math.max(...input.koreanNeeds) >
      seriesDirectionCompatibility({
        candidates: input.candidates,
        direction: "korean_to_english",
      }).maximumCount
  ) {
    return null;
  }

  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const rankById = new Map(
    input.candidates.map((candidate, index) => [candidate.id, index]),
  );
  const bitById = new Map(
    input.candidates.map((candidate, index) => [candidate.id, 1 << index]),
  );

  if (input.distribution === "repeat") {
    const exhaustiveConfigurationBudget = 200_000;
    const cappedCombinationCount = (count: number, selected: number) => {
      if (selected < 0 || selected > count) return 0;
      const smallerSide = Math.min(selected, count - selected);
      let combinations = 1;
      for (let index = 1; index <= smallerSide; index += 1) {
        combinations = (combinations * (count - smallerSide + index)) / index;
        if (combinations > exhaustiveConfigurationBudget) {
          return exhaustiveConfigurationBudget + 1;
        }
      }
      return combinations;
    };
    type SessionConfiguration = {
      mask: number;
      targets: PlannedVocabSeriesTarget[];
    };
    const configurationCache = new Map<string, SessionConfiguration[] | null>();
    const configurationsFor = (
      englishNeed: number,
      koreanNeed: number,
    ): SessionConfiguration[] | null => {
      const key = `${englishNeed}:${koreanNeed}`;
      if (configurationCache.has(key)) return configurationCache.get(key)!;
      const englishEligibleCount = input.candidates.filter((candidate) =>
        candidate.eligibleDirections.includes("english_to_korean"),
      ).length;
      const koreanEligibleCount = input.candidates.filter((candidate) =>
        candidate.eligibleDirections.includes("korean_to_english"),
      ).length;
      if (
        cappedCombinationCount(englishEligibleCount, englishNeed) *
          cappedCombinationCount(koreanEligibleCount, koreanNeed) >
        exhaustiveConfigurationBudget
      ) {
        configurationCache.set(key, null);
        return null;
      }
      const directions = [
        ...Array.from(
          { length: englishNeed },
          () => "english_to_korean" as const,
        ),
        ...Array.from(
          { length: koreanNeed },
          () => "korean_to_english" as const,
        ),
      ];
      const targets: PlannedVocabSeriesTarget[] = [];
      const lastRank = {
        english_to_korean: -1,
        korean_to_english: -1,
      };
      const configurationByMask = new Map<number, SessionConfiguration>();
      let remainingBudget = exhaustiveConfigurationBudget;
      let exhausted = false;
      const visit = (slotIndex: number, mask: number) => {
        if (remainingBudget < 1) {
          exhausted = true;
          return;
        }
        remainingBudget -= 1;
        if (slotIndex === directions.length) {
          if (!configurationByMask.has(mask)) {
            configurationByMask.set(mask, {
              mask,
              targets: [...targets],
            });
          }
          return;
        }
        const direction = directions[slotIndex]!;
        const minimumRank = lastRank[direction];
        for (const candidate of input.candidates) {
          const rank = rankById.get(candidate.id)!;
          const bit = bitById.get(candidate.id)!;
          if (
            rank <= minimumRank ||
            (mask & bit) !== 0 ||
            !candidate.eligibleDirections.includes(direction) ||
            !canPlaceSeriesTarget({
              candidate,
              direction,
              session: targets,
              candidateById,
            })
          ) {
            continue;
          }
          const previousLastRank = lastRank[direction];
          lastRank[direction] = rank;
          targets.push({ id: candidate.id, direction });
          visit(slotIndex + 1, mask | bit);
          targets.pop();
          lastRank[direction] = previousLastRank;
          if (exhausted) return;
        }
      };
      visit(0, 0);
      const configurations = exhausted
        ? null
        : [...configurationByMask.values()];
      configurationCache.set(key, configurations);
      return configurations;
    };

    type RepeatState = {
      mask: number;
      plan: PlannedVocabSeriesTarget[][];
    };
    let states = new Map<number, RepeatState>([[
      0,
      { mask: 0, plan: [] },
    ]]);
    for (const [sessionIndex, englishNeed] of input.englishNeeds.entries()) {
      const configurations = configurationsFor(
        englishNeed,
        input.koreanNeeds[sessionIndex]!,
      );
      if (!configurations || configurations.length === 0) return null;
      const nextStates = new Map<number, RepeatState>();
      for (const state of states.values()) {
        for (const configuration of configurations) {
          const mask = state.mask | configuration.mask;
          if (nextStates.has(mask)) continue;
          nextStates.set(mask, {
            mask,
            plan: [...state.plan, configuration.targets],
          });
          if (nextStates.size > 250_000) return null;
        }
      }
      states = nextStates;
    }
    const bitCount = (mask: number) => {
      let count = 0;
      let remaining = mask;
      while (remaining !== 0) {
        remaining &= remaining - 1;
        count += 1;
      }
      return count;
    };
    return [...states.values()].toSorted(
      (left, right) => bitCount(right.mask) - bitCount(left.mask),
    )[0]?.plan ?? null;
  }

  const plan: PlannedVocabSeriesTarget[][] = input.englishNeeds.map(() => []);
  const slots = input.englishNeeds.flatMap((englishNeed, sessionIndex) => [
    ...Array.from({ length: englishNeed }, () => ({
      sessionIndex,
      direction: "english_to_korean" as const,
    })),
    ...Array.from({ length: input.koreanNeeds[sessionIndex]! }, () => ({
      sessionIndex,
      direction: "korean_to_english" as const,
    })),
  ]);
  const globalUseCount = new Map<number, number>();
  const lastRank = input.englishNeeds.map(() => ({
    english_to_korean: -1,
    korean_to_english: -1,
  }));
  const maximumUniqueCount = Math.min(input.candidates.length, requiredCount);
  let best: PlannedVocabSeriesTarget[][] | null = null;
  let bestUniqueCount = -1;
  let remainingBudget = 1_000_000;
  let reachedMaximum = false;
  const visited = new Set<string>();

  const visit = (slotIndex: number) => {
    if (reachedMaximum || remainingBudget < 1) return;
    remainingBudget -= 1;
    const remainingSlotCount = slots.length - slotIndex;
    const currentUniqueCount = globalUseCount.size;
    if (
      best &&
      currentUniqueCount + remainingSlotCount <= bestUniqueCount
    ) {
      return;
    }
    const slot = slots[slotIndex];
    if (slot) {
      const usedMask = [...globalUseCount.keys()].reduce(
        (mask, id) => mask | bitById.get(id)!,
        0,
      );
      const currentEnglishMask = plan[slot.sessionIndex]!.reduce(
        (mask, target) => target.direction === "english_to_korean"
          ? mask | bitById.get(target.id)!
          : mask,
        0,
      );
      const currentKoreanMask = plan[slot.sessionIndex]!.reduce(
        (mask, target) => target.direction === "korean_to_english"
          ? mask | bitById.get(target.id)!
          : mask,
        0,
      );
      const stateKey = `${slotIndex}:${usedMask}:${currentEnglishMask}:${currentKoreanMask}`;
      if (visited.has(stateKey)) return;
      visited.add(stateKey);
    }
    if (slotIndex === slots.length) {
      if (currentUniqueCount > bestUniqueCount) {
        best = plan.map((session) => [...session]);
        bestUniqueCount = currentUniqueCount;
        reachedMaximum = currentUniqueCount === maximumUniqueCount;
      }
      return;
    }

    const currentSlot = slots[slotIndex]!;
    const session = plan[currentSlot.sessionIndex]!;
    const minimumRank = lastRank[currentSlot.sessionIndex]![currentSlot.direction];
    const orderedCandidates = [...input.candidates].toSorted((left, right) => {
      const leftUsed = Number(globalUseCount.has(left.id));
      const rightUsed = Number(globalUseCount.has(right.id));
      return leftUsed - rightUsed || rankById.get(left.id)! - rankById.get(right.id)!;
    });
    for (const candidate of orderedCandidates) {
      const rank = rankById.get(candidate.id)!;
      if (
        rank <= minimumRank ||
        !candidate.eligibleDirections.includes(currentSlot.direction) ||
        (input.distribution === "split" && globalUseCount.has(candidate.id)) ||
        !canPlaceSeriesTarget({
          candidate,
          direction: currentSlot.direction,
          session,
          candidateById,
        })
      ) {
        continue;
      }
      const previousLastRank = lastRank[currentSlot.sessionIndex]![currentSlot.direction];
      lastRank[currentSlot.sessionIndex]![currentSlot.direction] = rank;
      session.push({ id: candidate.id, direction: currentSlot.direction });
      globalUseCount.set(
        candidate.id,
        (globalUseCount.get(candidate.id) ?? 0) + 1,
      );
      visit(slotIndex + 1);
      const nextUseCount = globalUseCount.get(candidate.id)! - 1;
      if (nextUseCount === 0) globalUseCount.delete(candidate.id);
      else globalUseCount.set(candidate.id, nextUseCount);
      session.pop();
      lastRank[currentSlot.sessionIndex]![currentSlot.direction] = previousLastRank;
      if (reachedMaximum) return;
    }
  };

  visit(0);
  return best;
}

function planConflictAwareVocabSeries(input: {
  candidates: readonly VocabSeriesTarget[];
  distribution: VocabRangeDistribution;
  selectionMode: VocabTargetSelectionMode;
  sessionQuestionCounts: readonly number[];
  englishNeeds: readonly number[];
  koreanNeeds: readonly number[];
  seedScope: string;
}): PlannedVocabSeriesTarget[][] {
  const searchedPlan = searchSmallConflictAwareSeriesPlan({
    candidates: input.candidates,
    distribution: input.distribution,
    selectionMode: input.selectionMode,
    englishNeeds: input.englishNeeds,
    koreanNeeds: input.koreanNeeds,
  });
  if (searchedPlan) return searchedPlan;

  const sourceRank = new Map(
    input.candidates.map((candidate, index) => [candidate.id, index]),
  );
  const maximumAttempts = Math.min(
    12,
    Math.max(4, input.sessionQuestionCounts.length * 2),
  );
  const requiredCount = input.sessionQuestionCounts.reduce(
    (total, count) => total + count,
    0,
  );
  const maximumUniqueCount = Math.min(input.candidates.length, requiredCount);
  let bestPlan: PlannedVocabSeriesTarget[][] | null = null;
  let bestUniqueCount = -1;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const used = new Set<number>();
    const useCount = new Map<number, number>();
    const planned: PlannedVocabSeriesTarget[][] = input.sessionQuestionCounts
      .map(() => []);

    for (const [sessionIndex, questionCount] of input.sessionQuestionCounts.entries()) {
      const randomRank = new Map(
        shuffledIds(
          input.candidates.map((candidate) => candidate.id),
          `${input.seedScope}:conflicts:${attempt}:${sessionIndex}`,
        ).map((id, index) => [id, index]),
      );
      const candidates = input.candidates
        .filter(
          (candidate) =>
            input.distribution !== "split" || !used.has(candidate.id),
        )
        .toSorted((left, right) => {
          if (input.selectionMode === "random") {
            const usageDifference =
              (useCount.get(left.id) ?? 0) - (useCount.get(right.id) ?? 0);
            if (usageDifference !== 0) return usageDifference;
            return randomRank.get(left.id)! - randomRank.get(right.id)!;
          }
          if (attempt % 3 === 1) {
            const directionDifference =
              left.eligibleDirections.length - right.eligibleDirections.length;
            if (directionDifference !== 0) return directionDifference;
          }
          return sourceRank.get(left.id)! - sourceRank.get(right.id)!;
        });
      const remaining = {
        english: input.englishNeeds[sessionIndex]!,
        korean: input.koreanNeeds[sessionIndex]!,
      };
      const answersByDirectionAndPrompt = {
        english_to_korean: new Map<string, string>(),
        korean_to_english: new Map<string, string>(),
      };
      const selected: PlannedVocabSeriesTarget[] = [];

      for (const candidate of candidates) {
        if (selected.length === questionCount) break;
        const compatibleDirections = candidate.eligibleDirections.filter(
          (direction) => {
            const directionNeed = direction === "english_to_korean"
              ? remaining.english
              : remaining.korean;
            if (directionNeed < 1) return false;
            const { promptKey, answerKey } = targetConflictKey(
              candidate,
              direction,
            );
            const previousAnswer =
              answersByDirectionAndPrompt[direction].get(promptKey);
            return previousAnswer === undefined || previousAnswer === answerKey;
          },
        );
        if (compatibleDirections.length === 0) continue;
        let direction = compatibleDirections[0]!;
        if (compatibleDirections.length === 2) {
          if (remaining.english === remaining.korean) {
            direction = attempt % 2 === 0
              ? "english_to_korean"
              : "korean_to_english";
          } else {
            direction = remaining.english > remaining.korean
              ? "english_to_korean"
              : "korean_to_english";
          }
        }
        const { promptKey, answerKey } = targetConflictKey(
          candidate,
          direction,
        );
        answersByDirectionAndPrompt[direction].set(promptKey, answerKey);
        selected.push({ id: candidate.id, direction });
        if (direction === "english_to_korean") remaining.english -= 1;
        else remaining.korean -= 1;
      }

      if (
        selected.length !== questionCount ||
        remaining.english !== 0 ||
        remaining.korean !== 0
      ) {
        planned[sessionIndex] = selected;
        for (const target of selected) {
          used.add(target.id);
          useCount.set(target.id, (useCount.get(target.id) ?? 0) + 1);
        }
        break;
      }
      selected.sort(
        (left, right) => sourceRank.get(left.id)! - sourceRank.get(right.id)!,
      );
      planned[sessionIndex] = selected;
      for (const target of selected) {
        used.add(target.id);
        useCount.set(target.id, (useCount.get(target.id) ?? 0) + 1);
      }
    }
    const completed = completeConflictAwareSeriesPlan({
      plan: planned,
      candidates: input.candidates,
      distribution: input.distribution,
      selectionMode: input.selectionMode,
      englishNeeds: input.englishNeeds,
      koreanNeeds: input.koreanNeeds,
    });
    if (completed) {
      for (const session of completed) {
        session.sort(
          (left, right) => sourceRank.get(left.id)! - sourceRank.get(right.id)!,
        );
      }
      const uniqueCount = new Set(
        completed.flatMap((session) => session.map((target) => target.id)),
      ).size;
      if (uniqueCount > bestUniqueCount) {
        bestPlan = completed;
        bestUniqueCount = uniqueCount;
      }
      if (
        input.distribution !== "repeat" ||
        input.selectionMode !== "random" ||
        uniqueCount === maximumUniqueCount
      ) {
        return completed;
      }
    }
  }
  return bestPlan ?? [];
}

/**
 * Plans the exact target IDs for every quiz while respecting each target's
 * validated directions. Split uses every target once; random repeat exhausts
 * each direction pool before starting its next cycle.
 */
export function planDirectionalVocabSeriesTargets(input: {
  candidates: readonly VocabSeriesTarget[];
  distribution: VocabRangeDistribution;
  selectionMode: VocabTargetSelectionMode;
  sessionQuestionCounts: readonly number[];
  englishToKoreanRatio: 0 | 50 | 100;
  seedScope: string;
}): PlannedVocabSeriesTarget[][] {
  const candidateIds = input.candidates.map((candidate) => candidate.id);
  if (
    !input.seedScope.trim() ||
    new Set(candidateIds).size !== candidateIds.length ||
    candidateIds.length < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
    input.sessionQuestionCounts.length === 0 ||
    input.sessionQuestionCounts.some(
      (count) =>
        !Number.isInteger(count) ||
        count < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
        count > candidateIds.length,
    )
  ) {
    return [];
  }

  const englishNeeds = input.sessionQuestionCounts.map((count) =>
    englishQuestionCount(count, input.englishToKoreanRatio)
  );
  const koreanNeeds = input.sessionQuestionCounts.map(
    (count, index) => count - englishNeeds[index]!,
  );
  const needsEnglish = englishNeeds.some((count) => count > 0);
  const needsKorean = koreanNeeds.some((count) => count > 0);
  const relevantCandidates = input.candidates.filter((candidate) =>
    (needsEnglish && candidate.eligibleDirections.includes("english_to_korean")) ||
    (needsKorean && candidate.eligibleDirections.includes("korean_to_english"))
  );
  if (
    relevantCandidates.length < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
    input.sessionQuestionCounts.some(
      (count) => count > relevantCandidates.length,
    )
  ) {
    return [];
  }
  const candidateById = new Map(relevantCandidates.map((candidate) => [
    candidate.id,
    candidate,
  ]));
  const relevantCandidateIds = relevantCandidates.map((candidate) => candidate.id);
  const orderedCandidates = input.selectionMode === "source_order"
    ? [...relevantCandidates]
    : shuffledIds(relevantCandidateIds, `${input.seedScope}:targets`).map(
        (id) => candidateById.get(id)!,
      );
  const feasibleCandidates = pruneNeverFeasibleSeriesDirections({
    candidates: orderedCandidates,
    englishNeeds,
    koreanNeeds,
  });
  if (
    feasibleCandidates.length < MINIMUM_VOCAB_SESSION_QUESTION_COUNT ||
    input.sessionQuestionCounts.some((count) => count > feasibleCandidates.length)
  ) {
    return [];
  }
  if (hasPotentialSeriesPromptConflict(feasibleCandidates)) {
    return planConflictAwareVocabSeries({
      candidates: feasibleCandidates,
      distribution: input.distribution,
      selectionMode: input.selectionMode,
      sessionQuestionCounts: input.sessionQuestionCounts,
      englishNeeds,
      koreanNeeds,
      seedScope: input.seedScope,
    });
  }
  const totalEnglishNeed = englishNeeds.reduce((sum, count) => sum + count, 0);
  const totalKoreanNeed = koreanNeeds.reduce((sum, count) => sum + count, 0);
  const classCounts = { english: 0, korean: 0, both: 0 };
  for (const candidate of feasibleCandidates) {
    const direction = targetDirectionClass(candidate);
    if (!direction) return [];
    classCounts[direction] += 1;
  }
  const maximumEnglishNeed = Math.max(...englishNeeds);
  const maximumKoreanNeed = Math.max(...koreanNeeds);
  let poolEnglishCount: number;
  let poolKoreanCount: number;
  if (input.distribution === "split") {
    poolEnglishCount = totalEnglishNeed;
    poolKoreanCount = totalKoreanNeed;
  } else if (input.selectionMode === "source_order") {
    poolEnglishCount = maximumEnglishNeed;
    poolKoreanCount = maximumKoreanNeed;
  } else {
    let bestEnglishCount = -1;
    let bestKoreanCount = -1;
    let bestTotal = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let bothForEnglish = 0; bothForEnglish <= classCounts.both; bothForEnglish += 1) {
      const englishCount = Math.min(
        totalEnglishNeed,
        classCounts.english + bothForEnglish,
      );
      const koreanCount = Math.min(
        totalKoreanNeed,
        classCounts.korean + classCounts.both - bothForEnglish,
      );
      if (
        englishCount < maximumEnglishNeed ||
        koreanCount < maximumKoreanNeed
      ) {
        continue;
      }
      const total = englishCount + koreanCount;
      const distance =
        Math.abs(totalEnglishNeed - englishCount) +
        Math.abs(totalKoreanNeed - koreanCount);
      if (total > bestTotal || (total === bestTotal && distance < bestDistance)) {
        bestEnglishCount = englishCount;
        bestKoreanCount = koreanCount;
        bestTotal = total;
        bestDistance = distance;
      }
    }
    if (bestTotal < 0) return [];
    poolEnglishCount = bestEnglishCount;
    poolKoreanCount = bestKoreanCount;
  }

  const selectedCandidates = selectDirectionalTargetPool({
    candidates: feasibleCandidates,
    targetCount: poolEnglishCount + poolKoreanCount,
    englishCount: poolEnglishCount,
    koreanCount: poolKoreanCount,
  });
  if (selectedCandidates.length !== poolEnglishCount + poolKoreanCount) {
    return [];
  }
  const selectedEnglishOnly = selectedCandidates.filter(
    (candidate) => targetDirectionClass(candidate) === "english",
  );
  const selectedBoth = selectedCandidates.filter(
    (candidate) => targetDirectionClass(candidate) === "both",
  );
  const bothForEnglish = poolEnglishCount - selectedEnglishOnly.length;
  if (bothForEnglish < 0 || bothForEnglish > selectedBoth.length) return [];

  const englishIds = new Set([
    ...selectedEnglishOnly.map((candidate) => candidate.id),
    ...selectedBoth.slice(0, bothForEnglish).map((candidate) => candidate.id),
  ]);
  const englishPool = selectedCandidates
    .filter((candidate) => englishIds.has(candidate.id))
    .map((candidate) => candidate.id);
  const koreanPool = selectedCandidates
    .filter((candidate) => !englishIds.has(candidate.id))
    .map((candidate) => candidate.id);
  const orderById = new Map(
    selectedCandidates.map((candidate, index) => [candidate.id, index]),
  );
  const mergeBySelectionOrder = (english: number[], korean: number[]) =>
    [...english, ...korean].toSorted(
      (left, right) => orderById.get(left)! - orderById.get(right)!,
    );

  if (input.distribution === "split") {
    let englishCursor = 0;
    let koreanCursor = 0;
    return input.sessionQuestionCounts.map((_count, index) => {
      const english = englishPool.slice(
        englishCursor,
        englishCursor + englishNeeds[index]!,
      );
      const korean = koreanPool.slice(
        koreanCursor,
        koreanCursor + koreanNeeds[index]!,
      );
      englishCursor += english.length;
      koreanCursor += korean.length;
      return mergeBySelectionOrder(english, korean).map((id) => ({
        id,
        direction: englishIds.has(id)
          ? "english_to_korean" as const
          : "korean_to_english" as const,
      }));
    });
  }

  if (input.selectionMode === "source_order") {
    return input.sessionQuestionCounts.map((_count, index) =>
      mergeBySelectionOrder(
        englishPool.slice(0, englishNeeds[index]),
        koreanPool.slice(0, koreanNeeds[index]),
      ).map((id) => ({
        id,
        direction: englishIds.has(id)
          ? "english_to_korean" as const
          : "korean_to_english" as const,
      }))
    );
  }

  const englishState = {
    cycle: 0,
    queue: shuffledIds(
      englishPool,
      `${input.seedScope}:english_to_korean:0`,
    ),
  };
  const koreanState = {
    cycle: 0,
    queue: shuffledIds(
      koreanPool,
      `${input.seedScope}:korean_to_english:0`,
    ),
  };
  return input.sessionQuestionCounts.map((_count, index) =>
    mergeBySelectionOrder(
      takeFromRandomDirectionCycle({
        pool: englishPool,
        count: englishNeeds[index]!,
        seedScope: input.seedScope,
        direction: "english_to_korean",
        state: englishState,
      }),
      takeFromRandomDirectionCycle({
        pool: koreanPool,
        count: koreanNeeds[index]!,
        seedScope: input.seedScope,
        direction: "korean_to_english",
        state: koreanState,
      }),
    ).map((id) => ({
      id,
      direction: englishIds.has(id)
        ? "english_to_korean" as const
        : "korean_to_english" as const,
    }))
  );
}

export function planDirectionalVocabSeriesTargetIds(
  input: Parameters<typeof planDirectionalVocabSeriesTargets>[0],
): number[][] {
  return planDirectionalVocabSeriesTargets(input).map((session) =>
    session.map((target) => target.id)
  );
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
