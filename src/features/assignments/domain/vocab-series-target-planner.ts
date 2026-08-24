import type {
  PlannedVocabSeriesTarget,
  VocabRangeDistribution,
  VocabSeriesTarget,
  VocabTargetDirection,
  VocabTargetSelectionMode,
} from "./vocab-assignment-contract";
import { MINIMUM_VOCAB_SESSION_QUESTION_COUNT } from "./vocab-assignment-contract";

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
