import type {
  VocabExtraDatePolicy,
  VocabSplitOverflowPolicy,
  VocabUnitCycleAllocation,
  VocabUnitCycleAllocationIssue,
} from "./vocab-assignment-contract";

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
