import {
  calculateMixedQuizQuestionRange,
  createMixedQuizQuestions,
  selectMixedQuizTargetsInSourceOrder,
} from "@/lib/quiz/mixed-question-planner";
import {
  createExplicitTargetedQuizQuestions,
  createTargetedQuizQuestions,
} from "@/lib/quiz/question-generator";
import {
  quizIndependentTargetDirectionEligibility,
} from "@/lib/quiz/choice-policy";
import type {
  QuizQuestionDraft,
  QuizVocabularyEntry,
  RandomSource,
} from "@/lib/quiz/question-types";

export const ASSIGNMENT_QUESTION_PLAN_VERSION =
  "source-occurrence-v2-exact";

export type AssignmentQuestionRatio = 0 | 50 | 100;

export type AssignmentQuestionPlanInput = {
  requiredTargets?: readonly QuizVocabularyEntry[];
  primaryCandidates: readonly QuizVocabularyEntry[];
  allCandidates: readonly QuizVocabularyEntry[];
  questionCount: number;
  englishToKoreanRatio: AssignmentQuestionRatio;
  targetSelectionMode?: "source_order" | "random";
  randomSeed?: string;
};

export type AssignmentQuestionCapacityInput = Omit<
  AssignmentQuestionPlanInput,
  "questionCount"
>;

export type ExactAssignmentQuestionPlanInput = {
  targets: readonly QuizVocabularyEntry[];
  allCandidates: readonly QuizVocabularyEntry[];
  englishToKoreanRatio: AssignmentQuestionRatio;
  randomSeed: string;
  targetDirections?: readonly ("english_to_korean" | "korean_to_english")[];
};

function deterministicPlanRandom(
  input: AssignmentQuestionPlanInput,
  scope = "default",
): RandomSource {
  let state = 2166136261;
  const mix = (value: number) => {
    state ^= value >>> 0;
    state = Math.imul(state, 16777619) >>> 0;
  };
  mix(input.questionCount);
  mix(input.englishToKoreanRatio);
  for (const character of `${scope}:${input.randomSeed ?? ""}`) {
    mix(character.codePointAt(0) ?? 0);
  }
  for (const entry of input.requiredTargets ?? []) mix(entry.id);
  mix(0x9e3779b9);
  for (const entry of input.primaryCandidates) mix(entry.id);
  mix(0x85ebca6b);
  for (const entry of input.allCandidates) mix(entry.id);

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Assignment preview and persistence both enter the quiz engine through this
 * boundary. Target identity is the source occurrence (`vocab_entries.id`).
 */
export function buildAssignmentQuestionPlan(
  input: AssignmentQuestionPlanInput,
  random?: RandomSource,
): QuizQuestionDraft[] {
  const args = [
    input.requiredTargets ?? [],
    input.primaryCandidates,
    input.allCandidates,
    input.questionCount,
    input.englishToKoreanRatio,
  ] as const;

  if (
    random ||
    (!input.targetSelectionMode && !input.randomSeed)
  ) {
    return createMixedQuizQuestions(
      ...args,
      random ?? deterministicPlanRandom(input),
    );
  }

  const selectedTargets = input.targetSelectionMode === "source_order"
    ? selectMixedQuizTargetsInSourceOrder(...args)
    : (() => {
        const selectedQuestions = createMixedQuizQuestions(
          ...args,
          deterministicPlanRandom(input, "targets"),
        );
        const candidateById = new Map(
          input.allCandidates.map((candidate) => [candidate.id, candidate]),
        );
        return selectedQuestions.map((question) => {
          const target = candidateById.get(question.vocabEntryId);
          if (!target) {
            throw new Error("선택한 출제 대상이 보기 후보 범위에 없습니다.");
          }
          return target;
        });
      })();

  return createTargetedQuizQuestions(
    selectedTargets,
    input.allCandidates,
    input.englishToKoreanRatio,
    deterministicPlanRandom(input, "questions"),
    { allowRepeatedVocabularyIdentity: true },
  );
}

/** Builds one paper from already planned source-occurrence IDs. */
export function buildExactAssignmentQuestionPlan(
  input: ExactAssignmentQuestionPlanInput,
) {
  const randomInput: AssignmentQuestionPlanInput = {
    requiredTargets: [],
    primaryCandidates: input.targets,
    allCandidates: input.allCandidates,
    questionCount: input.targets.length,
    englishToKoreanRatio: input.englishToKoreanRatio,
    targetSelectionMode: "source_order",
    randomSeed: input.randomSeed,
  };
  if (input.targetDirections) {
    const expectedEnglishCount = Math.round(
      input.targets.length * (input.englishToKoreanRatio / 100),
    );
    if (
      input.targetDirections.length !== input.targets.length ||
      input.targetDirections.filter(
        (direction) => direction === "english_to_korean",
      ).length !== expectedEnglishCount
    ) {
      throw new Error("확정 출제 대상의 문제 방향 수가 요청 비율과 다릅니다.");
    }
    return createExplicitTargetedQuizQuestions(
      input.targets.map((target, index) => ({
        id: target.id,
        direction: input.targetDirections![index]!,
      })),
      input.allCandidates,
      deterministicPlanRandom(randomInput, "exact-targets"),
    );
  }
  return createTargetedQuizQuestions(
    input.targets,
    input.allCandidates,
    input.englishToKoreanRatio,
    deterministicPlanRandom(randomInput, "exact-targets"),
    { allowRepeatedVocabularyIdentity: true },
  );
}

/**
 * Finds the exact largest count accepted by the same planner used for save.
 * The engine filters targets that cannot produce four distinct choices before
 * target selection, so a different creation shuffle cannot invalidate this
 * result.
 */
export function calculateAssignmentQuestionRange(
  input: AssignmentQuestionCapacityInput,
) {
  const requiredTargets = input.requiredTargets ?? [];
  return calculateMixedQuizQuestionRange(
    requiredTargets,
    input.primaryCandidates,
    input.allCandidates,
    input.englishToKoreanRatio,
  );
}

export function calculateAssignmentQuestionCapacity(
  input: AssignmentQuestionCapacityInput,
) {
  return calculateAssignmentQuestionRange(input).maximumQuestionCount;
}

export function calculateAssignmentSeriesQuestionCapacity(
  input: AssignmentQuestionCapacityInput,
) {
  const requiredTargets = input.requiredTargets ?? [];
  const requiredIds = new Set(requiredTargets.map((target) => target.id));
  const primaryCandidates = input.primaryCandidates.filter(
    (candidate) => !requiredIds.has(candidate.id),
  );
  const allTargets = [...requiredTargets, ...primaryCandidates];
  const eligibilityById = new Map(
    quizIndependentTargetDirectionEligibility(
      allTargets,
      input.allCandidates,
    ).map((candidate) => [candidate.id, candidate.eligibleDirections]),
  );
  const classify = (candidate: QuizVocabularyEntry) => {
    const directions = eligibilityById.get(candidate.id) ?? [];
    const english = directions.includes("english_to_korean");
    const korean = directions.includes("korean_to_english");
    if (english && korean) return "both" as const;
    if (english) return "english" as const;
    if (korean) return "korean" as const;
    return "none" as const;
  };
  const requiredCounts = { english: 0, korean: 0, both: 0, none: 0 };
  const primaryCounts = { english: 0, korean: 0, both: 0 };
  for (const candidate of requiredTargets) requiredCounts[classify(candidate)] += 1;
  for (const candidate of primaryCandidates) {
    const direction = classify(candidate);
    if (direction !== "none") primaryCounts[direction] += 1;
  }
  if (requiredCounts.none > 0) return 0;
  const requiredCount = requiredTargets.length;
  const maximum = requiredCount + primaryCounts.english +
    primaryCounts.korean + primaryCounts.both;
  for (let total = maximum; total >= Math.max(4, requiredCount); total -= 1) {
    const englishNeed = Math.round(
      total * (input.englishToKoreanRatio / 100),
    );
    const koreanNeed = total - englishNeed;
    for (
      let requiredBothForEnglish = 0;
      requiredBothForEnglish <= requiredCounts.both;
      requiredBothForEnglish += 1
    ) {
      const optionalEnglishNeed = englishNeed - requiredCounts.english -
        requiredBothForEnglish;
      const optionalKoreanNeed = koreanNeed - requiredCounts.korean -
        (requiredCounts.both - requiredBothForEnglish);
      if (optionalEnglishNeed < 0 || optionalKoreanNeed < 0) continue;
      const minimumBothNeeded = Math.max(
        0,
        optionalEnglishNeed - primaryCounts.english,
      ) + Math.max(0, optionalKoreanNeed - primaryCounts.korean);
      if (
        minimumBothNeeded <= primaryCounts.both &&
        optionalEnglishNeed + optionalKoreanNeed <=
          primaryCounts.english + primaryCounts.korean + primaryCounts.both
      ) {
        return total;
      }
    }
  }
  return 0;
}
