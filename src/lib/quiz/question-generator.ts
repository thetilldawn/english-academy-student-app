import type { QuizDirection, QuizQuestionDraft, QuizVocabularyEntry, RandomSource } from "./question-types";
import { buildDirectionalQuestionSets, buildQuizChoiceIndex, canUseDirection, createChoices } from "./choice-policy";
import { quizVocabularyIdentity } from "./word-identity";
import { secureRandom, shuffle } from "./random";

export function createQuizQuestions(
  entries: readonly QuizVocabularyEntry[],
  questionCount: number,
  englishToKoreanRatio = 50,
  random: RandomSource = secureRandom,
): QuizQuestionDraft[] {
  if (
    !Number.isInteger(questionCount) ||
    questionCount < 4 ||
    questionCount > entries.length
  ) {
    throw new Error("문항 수가 어휘 범위를 벗어났습니다.");
  }

  if (englishToKoreanRatio < 0 || englishToKoreanRatio > 100) {
    throw new Error("문항 방향 비율은 0~100이어야 합니다.");
  }

  const englishCount = Math.round(
    questionCount * (englishToKoreanRatio / 100),
  );
  const koreanCount = questionCount - englishCount;
  const {
    englishCandidates: englishEligible,
    koreanCandidates: koreanEligible,
  } = buildDirectionalQuestionSets(entries, entries);
  const choiceIndex = buildQuizChoiceIndex(entries);
  const englishIds = new Set(englishEligible.map((entry) => entry.id));
  const koreanIds = new Set(koreanEligible.map((entry) => entry.id));
  const englishOnly = englishEligible.filter(
    (entry) => !koreanIds.has(entry.id),
  );
  const koreanOnly = koreanEligible.filter(
    (entry) => !englishIds.has(entry.id),
  );
  const both = englishEligible.filter((entry) =>
    koreanIds.has(entry.id),
  );

  const selectedKoreanOnly = shuffle(koreanOnly, random).slice(
    0,
    koreanCount,
  );
  const remainingKoreanCount =
    koreanCount - selectedKoreanOnly.length;
  const selectedKoreanFromBoth = shuffle(both, random).slice(
    0,
    remainingKoreanCount,
  );
  const selectedKorean = [
    ...selectedKoreanOnly,
    ...selectedKoreanFromBoth,
  ];
  const selectedKoreanIds = new Set(
    selectedKorean.map((entry) => entry.id),
  );

  const selectedEnglishOnly = shuffle(englishOnly, random).slice(
    0,
    englishCount,
  );
  const remainingEnglishCount =
    englishCount - selectedEnglishOnly.length;
  const selectedEnglishFromBoth = shuffle(
    both.filter((entry) => !selectedKoreanIds.has(entry.id)),
    random,
  ).slice(0, remainingEnglishCount);
  const selectedEnglish = [
    ...selectedEnglishOnly,
    ...selectedEnglishFromBoth,
  ];

  if (
    selectedKorean.length < koreanCount ||
    selectedEnglish.length < englishCount
  ) {
    throw new Error(
      "선택한 범위에 문제 방향별로 검증된 단어가 부족합니다.",
    );
  }

  const selected = shuffle(
    [
      ...selectedEnglish.map((entry) => ({
        entry,
        direction: "english_to_korean" as const,
      })),
      ...selectedKorean.map((entry) => ({
        entry,
        direction: "korean_to_english" as const,
      })),
    ],
    random,
  );

  return selected.map(({ entry, direction }) => {
    const display =
      direction === "english_to_korean"
        ? (candidate: QuizVocabularyEntry) =>
            candidate.primaryMeaning
        : (candidate: QuizVocabularyEntry) => candidate.headword;
    const {
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    } = createChoices(
      entry,
      direction,
      display,
      random,
      choiceIndex,
    );

    return {
      vocabEntryId: entry.id,
      direction,
      prompt:
        direction === "english_to_korean"
          ? entry.headword
          : entry.primaryMeaning,
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    };
  });
}

export function createTargetedQuizQuestions(
  targets: readonly QuizVocabularyEntry[],
  candidates: readonly QuizVocabularyEntry[],
  englishToKoreanRatio = 50,
  random: RandomSource = secureRandom,
  options: { allowRepeatedVocabularyIdentity?: boolean } = {},
): QuizQuestionDraft[] {
  if (
    targets.length < 1 ||
    targets.length > 500 ||
    new Set(targets.map((entry) => entry.id)).size !== targets.length
  ) {
    throw new Error(
      "복습 대상 단어는 같은 표제어를 겹치지 않고 1~500개여야 합니다.",
    );
  }
  if (![0, 50, 100].includes(englishToKoreanRatio)) {
    throw new Error("복습 시험 문항 방향 비율은 0, 50, 100 중 하나여야 합니다.");
  }

  const candidateById = new Map<number, QuizVocabularyEntry>();
  for (const candidate of candidates) {
    if (candidateById.has(candidate.id)) {
      throw new Error("보기 후보 단어 ID가 중복되었습니다.");
    }
    candidateById.set(candidate.id, candidate);
  }
  const trustedTargets = targets.map((target) => {
    const candidate = candidateById.get(target.id);
    if (!candidate) {
      throw new Error("복습 대상 단어가 보기 후보 범위에 없습니다.");
    }
    return candidate;
  });
  if (
    !options.allowRepeatedVocabularyIdentity &&
    new Set(trustedTargets.map(quizVocabularyIdentity)).size !==
    trustedTargets.length
  ) {
    throw new Error(
      "복습 대상 단어는 같은 표제어를 겹치지 않고 1~500개여야 합니다.",
    );
  }

  const {
    englishCandidateIds,
    koreanCandidateIds,
    promptSafeCandidateIds,
  } = buildDirectionalQuestionSets(trustedTargets, candidates);
  const choiceIndex = buildQuizChoiceIndex(candidates);
  const englishOnly = trustedTargets.filter(
    (entry) =>
      englishCandidateIds.has(entry.id) &&
      !koreanCandidateIds.has(entry.id),
  );
  const koreanOnly = trustedTargets.filter(
    (entry) =>
      koreanCandidateIds.has(entry.id) &&
      !englishCandidateIds.has(entry.id),
  );
  const both = trustedTargets.filter(
    (entry) =>
      englishCandidateIds.has(entry.id) &&
      koreanCandidateIds.has(entry.id),
  );

  if (
    englishOnly.length + koreanOnly.length + both.length !==
    trustedTargets.length
  ) {
    if (
      trustedTargets.some(
        (entry) =>
          promptSafeCandidateIds.has(entry.id) &&
          !englishCandidateIds.has(entry.id) &&
          !koreanCandidateIds.has(entry.id),
      )
    ) {
      throw new Error(
        "서로 다른 4지선다 보기를 만들 어휘가 부족합니다.",
      );
    }
    throw new Error("복습 대상에 출제 가능한 방향이 없는 단어가 있습니다.");
  }

  const expectedEnglishCount = Math.round(
    trustedTargets.length * (englishToKoreanRatio / 100),
  );
  const englishFromBothCount =
    expectedEnglishCount - englishOnly.length;
  if (
    englishFromBothCount < 0 ||
    englishFromBothCount > both.length ||
    koreanOnly.length >
      trustedTargets.length - expectedEnglishCount
  ) {
    throw new Error(
      "복습 대상의 검증된 출제 방향으로 요청 비율을 만들 수 없습니다.",
    );
  }

  const englishFromBothIds = new Set(
    shuffle(both, random)
      .slice(0, englishFromBothCount)
      .map((entry) => entry.id),
  );
  const englishTargetIds = new Set([
    ...englishOnly.map((entry) => entry.id),
    ...englishFromBothIds,
  ]);
  const assignedTargets = trustedTargets.map((entry) => ({
    entry,
    direction: englishTargetIds.has(entry.id)
      ? ("english_to_korean" as const)
      : ("korean_to_english" as const),
  }));

  return assignedTargets.map(({ entry, direction }) => {
    const display =
      direction === "english_to_korean"
        ? (candidate: QuizVocabularyEntry) =>
            candidate.primaryMeaning
        : (candidate: QuizVocabularyEntry) => candidate.headword;
    const {
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    } = createChoices(
      entry,
      direction,
      display,
      random,
      choiceIndex,
    );

    return {
      vocabEntryId: entry.id,
      direction,
      prompt:
        direction === "english_to_korean"
          ? entry.headword
          : entry.primaryMeaning,
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    };
  });
}

/**
 * Builds a paper from an exact occurrence-and-direction plan. Directions are
 * checked per paper, so a different sense assigned to another paper cannot
 * invalidate this one.
 */
export function createExplicitTargetedQuizQuestions(
  targets: readonly { id: number; direction: QuizDirection }[],
  candidates: readonly QuizVocabularyEntry[],
  random: RandomSource = secureRandom,
): QuizQuestionDraft[] {
  if (
    targets.length < 1 ||
    targets.length > 500 ||
    new Set(targets.map((target) => target.id)).size !== targets.length
  ) {
    throw new Error("확정 출제 대상은 서로 다른 1~500개 항목이어야 합니다.");
  }
  const candidateById = new Map<number, QuizVocabularyEntry>();
  for (const candidate of candidates) {
    if (candidateById.has(candidate.id)) {
      throw new Error("보기 후보 단어 ID가 중복되었습니다.");
    }
    candidateById.set(candidate.id, candidate);
  }
  const plannedTargets = targets.map((target) => {
    const entry = candidateById.get(target.id);
    if (!entry) {
      throw new Error("확정 출제 대상이 보기 후보 범위에 없습니다.");
    }
    if (!canUseDirection(entry, target.direction)) {
      throw new Error("확정 출제 대상에 사용할 수 없는 문제 방향이 있습니다.");
    }
    return { entry, direction: target.direction };
  });
  const englishTargets = plannedTargets
    .filter(({ direction }) => direction === "english_to_korean")
    .map(({ entry }) => entry);
  const koreanTargets = plannedTargets
    .filter(({ direction }) => direction === "korean_to_english")
    .map(({ entry }) => entry);
  const englishQuestionSets = buildDirectionalQuestionSets(
    englishTargets,
    candidates,
  );
  const koreanQuestionSets = buildDirectionalQuestionSets(
    koreanTargets,
    candidates,
  );
  if (
    englishTargets.some(
      (entry) => !englishQuestionSets.englishCandidateIds.has(entry.id),
    ) ||
    koreanTargets.some(
      (entry) => !koreanQuestionSets.koreanCandidateIds.has(entry.id),
    )
  ) {
    throw new Error(
      "확정 출제 대상에 같은 문제 문구의 다른 정답이 있거나 4지선다 보기가 부족합니다.",
    );
  }
  const choiceIndex = buildQuizChoiceIndex(candidates);

  return plannedTargets.map(({ entry, direction }) => {
    const display = direction === "english_to_korean"
      ? (candidate: QuizVocabularyEntry) => candidate.primaryMeaning
      : (candidate: QuizVocabularyEntry) => candidate.headword;
    const { choices, choiceVocabEntryIds, correctChoiceIndex } = createChoices(
      entry,
      direction,
      display,
      random,
      choiceIndex,
    );
    return {
      vocabEntryId: entry.id,
      direction,
      prompt: direction === "english_to_korean"
        ? entry.headword
        : entry.primaryMeaning,
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    };
  });
}

