import {
  MAXIMUM_VOCAB_SESSION_QUESTION_COUNT,
  MINIMUM_VOCAB_SESSION_QUESTION_COUNT,
  type VocabExtraDatePolicy,
  type VocabQuestionAllocation,
  type VocabQuestionAllocationIssue,
  type VocabQuestionCountChoice,
  type VocabQuestionCycleAllocation,
  type VocabRangeDistribution,
  type VocabSplitOverflowPolicy,
} from "./vocab-assignment-contract";

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
  overflowPolicy: VocabSplitOverflowPolicy;
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
    : input.overflowPolicy === "continue_weekly"
      ? baseCounts.length
      : Math.min(baseCounts.length, input.selectedDateCount);
  if (sessionCount > maximumSessionCount) {
    return empty("series_session_limit_exceeded");
  }
  const sessionQuestionCounts = shouldRepeat
    ? Array.from(
        { length: sessionCount },
        (_value, index) => baseCounts[index % baseCounts.length]!,
      )
    : baseCounts.slice(0, sessionCount);
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
