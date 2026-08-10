import {
  calculateMixedQuizQuestionRange,
  createMixedQuizQuestions,
  type QuizQuestionDraft,
  type QuizVocabularyEntry,
  type RandomSource,
} from "@/lib/quiz/engine";

export const ASSIGNMENT_QUESTION_PLAN_VERSION =
  "source-occurrence-v2-exact";

export type AssignmentQuestionRatio = 0 | 50 | 100;

export type AssignmentQuestionPlanInput = {
  requiredTargets?: readonly QuizVocabularyEntry[];
  primaryCandidates: readonly QuizVocabularyEntry[];
  allCandidates: readonly QuizVocabularyEntry[];
  questionCount: number;
  englishToKoreanRatio: AssignmentQuestionRatio;
};

export type AssignmentQuestionCapacityInput = Omit<
  AssignmentQuestionPlanInput,
  "questionCount"
>;

function deterministicPlanRandom(
  input: AssignmentQuestionPlanInput,
): RandomSource {
  let state = 2166136261;
  const mix = (value: number) => {
    state ^= value >>> 0;
    state = Math.imul(state, 16777619) >>> 0;
  };
  mix(input.questionCount);
  mix(input.englishToKoreanRatio);
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

  return createMixedQuizQuestions(
    ...args,
    random ?? deterministicPlanRandom(input),
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
