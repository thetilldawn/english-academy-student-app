import type { QuizQuestionDraft, QuizVocabularyEntry, RandomSource } from "./question-types";
import { buildDirectionalQuestionSets } from "./choice-policy";
import { createTargetedQuizQuestions } from "./question-generator";
import { quizVocabularyIdentity } from "./word-identity";
import { secureRandom, shuffle } from "./random";

type MixedCapacityDirection =
  | "both"
  | "english"
  | "korean"
  | "none";

function mixedCapacityDirection(
  entry: QuizVocabularyEntry,
  englishCandidateIds: ReadonlySet<number>,
  koreanCandidateIds: ReadonlySet<number>,
): MixedCapacityDirection {
  const english = englishCandidateIds.has(entry.id);
  const korean = koreanCandidateIds.has(entry.id);
  if (english && korean) return "both";
  if (english) return "english";
  if (korean) return "korean";
  return "none";
}

function isMixedQuestionCountFeasible(
  requiredClasses: readonly MixedCapacityDirection[],
  primaryCounts: {
    both: number;
    english: number;
    korean: number;
  },
  totalQuestionCount: number,
  englishToKoreanRatio: 0 | 50 | 100,
) {
  const generalQuestionCount =
    totalQuestionCount - requiredClasses.length;
  if (generalQuestionCount < 0) return false;

  const expectedEnglishCount = Math.round(
    totalQuestionCount * (englishToKoreanRatio / 100),
  );
  const expectedKoreanCount =
    totalQuestionCount - expectedEnglishCount;
  const requiredEnglishOnlyCount = requiredClasses.filter(
    (direction) => direction === "english",
  ).length;
  const requiredKoreanOnlyCount = requiredClasses.filter(
    (direction) => direction === "korean",
  ).length;
  const availableGeneralEnglish =
    expectedEnglishCount - requiredEnglishOnlyCount;
  const availableGeneralKorean =
    expectedKoreanCount - requiredKoreanOnlyCount;
  if (
    availableGeneralEnglish < 0 ||
    availableGeneralKorean < 0
  ) {
    return false;
  }

  const selectedBothCount = Math.min(
    primaryCounts.both,
    generalQuestionCount,
  );
  const fixedQuestionCount =
    generalQuestionCount - selectedBothCount;
  const maximumEnglishOnly = Math.min(
    primaryCounts.english,
    fixedQuestionCount,
  );

  for (
    let englishOnlyCount = maximumEnglishOnly;
    englishOnlyCount >= 0;
    englishOnlyCount -= 1
  ) {
    const koreanOnlyCount =
      fixedQuestionCount - englishOnlyCount;
    if (
      koreanOnlyCount < 0 ||
      koreanOnlyCount > primaryCounts.korean
    ) {
      continue;
    }
    if (
      englishOnlyCount <= availableGeneralEnglish &&
      koreanOnlyCount <= availableGeneralKorean
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates the exact contiguous count range without generating every
 * possible question paper. It shares the same prompt and distractor
 * eligibility rules as createMixedQuizQuestions.
 */
export function calculateMixedQuizQuestionRange(
  requiredTargets: readonly QuizVocabularyEntry[],
  primaryCandidates: readonly QuizVocabularyEntry[],
  allCandidates: readonly QuizVocabularyEntry[],
  englishToKoreanRatio: 0 | 50 | 100,
  questionCountLimit = 500,
  calculateMinimum = true,
) {
  const emptyRange = {
    minimumQuestionCount: 0,
    maximumQuestionCount: 0,
  };
  if (
    !Number.isInteger(questionCountLimit) ||
    questionCountLimit < 4 ||
    requiredTargets.length > questionCountLimit ||
    ![0, 50, 100].includes(englishToKoreanRatio)
  ) {
    return emptyRange;
  }

  const candidateById = new Map<number, QuizVocabularyEntry>();
  for (const candidate of allCandidates) {
    if (candidateById.has(candidate.id)) return emptyRange;
    candidateById.set(candidate.id, candidate);
  }
  if (
    new Set(requiredTargets.map((entry) => entry.id)).size !==
      requiredTargets.length ||
    new Set(primaryCandidates.map((entry) => entry.id)).size !==
      primaryCandidates.length
  ) {
    return emptyRange;
  }

  const trustedRequired = requiredTargets.map((target) =>
    candidateById.get(target.id),
  );
  const trustedPrimary = primaryCandidates.map((target) =>
    candidateById.get(target.id),
  );
  if (
    trustedRequired.some((entry) => !entry) ||
    trustedPrimary.some((entry) => !entry)
  ) {
    return emptyRange;
  }

  const required = trustedRequired as QuizVocabularyEntry[];
  const primary = trustedPrimary as QuizVocabularyEntry[];
  const requiredIds = new Set(required.map((entry) => entry.id));
  const requiredIdentities = new Set(
    required.map(quizVocabularyIdentity),
  );
  if (requiredIdentities.size !== required.length) {
    return emptyRange;
  }
  const availablePrimary = primary.filter(
    (entry) =>
      !requiredIds.has(entry.id) &&
      !requiredIdentities.has(quizVocabularyIdentity(entry)),
  );
  const targetScope = [...required, ...availablePrimary];
  const { englishCandidateIds, koreanCandidateIds } =
    buildDirectionalQuestionSets(targetScope, allCandidates);
  const classify = (entry: QuizVocabularyEntry) =>
    mixedCapacityDirection(
      entry,
      englishCandidateIds,
      koreanCandidateIds,
    );
  const requiredClasses = required.map(classify);
  if (requiredClasses.includes("none")) return emptyRange;

  const primaryClasses = availablePrimary.map(classify);
  const primaryCounts = {
    both: primaryClasses.filter((value) => value === "both").length,
    english: primaryClasses.filter((value) => value === "english")
      .length,
    korean: primaryClasses.filter((value) => value === "korean")
      .length,
  };
  const eligiblePrimaryCount =
    primaryCounts.both +
    primaryCounts.english +
    primaryCounts.korean;
  const minimumCandidateCount = Math.max(4, required.length);
  const maximumCandidateCount = Math.min(
    questionCountLimit,
    required.length + eligiblePrimaryCount,
  );
  let minimumQuestionCount = 0;
  let maximumQuestionCount = 0;

  for (
    let questionCount = maximumCandidateCount;
    questionCount >= minimumCandidateCount;
    questionCount -= 1
  ) {
    if (
      isMixedQuestionCountFeasible(
        requiredClasses,
        primaryCounts,
        questionCount,
        englishToKoreanRatio,
      )
    ) {
      if (maximumQuestionCount === 0) {
        maximumQuestionCount = questionCount;
      }
      minimumQuestionCount = questionCount;
      if (!calculateMinimum) break;
    } else if (maximumQuestionCount > 0) {
      break;
    }
  }

  return { minimumQuestionCount, maximumQuestionCount };
}

/**
 * Selects the earliest feasible target occurrences while preserving source
 * order. Direction-only targets are skipped only when taking them would make
 * the requested English/Korean ratio impossible to complete from the suffix.
 */
export function selectMixedQuizTargetsInSourceOrder(
  requiredTargets: readonly QuizVocabularyEntry[],
  primaryCandidates: readonly QuizVocabularyEntry[],
  allCandidates: readonly QuizVocabularyEntry[],
  totalQuestionCount: number,
  englishToKoreanRatio: 0 | 50 | 100,
): QuizVocabularyEntry[] {
  const range = calculateMixedQuizQuestionRange(
    requiredTargets,
    primaryCandidates,
    allCandidates,
    englishToKoreanRatio,
  );
  if (
    totalQuestionCount < range.minimumQuestionCount ||
    totalQuestionCount > range.maximumQuestionCount
  ) {
    throw new Error("범위 앞쪽 단어로 요청한 문항 수와 출제 방향을 만들 수 없습니다.");
  }

  const candidateById = new Map(
    allCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const required = requiredTargets.map(
    (target) => candidateById.get(target.id)!,
  );
  const requiredIds = new Set(required.map((entry) => entry.id));
  const requiredIdentities = new Set(required.map(quizVocabularyIdentity));
  const availablePrimary = primaryCandidates
    .map((candidate) => candidateById.get(candidate.id)!)
    .filter(
      (entry) =>
        !requiredIds.has(entry.id) &&
        !requiredIdentities.has(quizVocabularyIdentity(entry)),
    );
  const targetScope = [...required, ...availablePrimary];
  const { englishCandidateIds, koreanCandidateIds } =
    buildDirectionalQuestionSets(targetScope, allCandidates);
  const classify = (entry: QuizVocabularyEntry) =>
    mixedCapacityDirection(
      entry,
      englishCandidateIds,
      koreanCandidateIds,
    );
  const requiredClasses = required.map(classify);
  const expectedEnglishCount = Math.round(
    totalQuestionCount * (englishToKoreanRatio / 100),
  );
  const expectedKoreanCount = totalQuestionCount - expectedEnglishCount;
  const maximumGeneralEnglishOnly =
    expectedEnglishCount -
    requiredClasses.filter((direction) => direction === "english").length;
  const maximumGeneralKoreanOnly =
    expectedKoreanCount -
    requiredClasses.filter((direction) => direction === "korean").length;
  const generalQuestionCount = totalQuestionCount - required.length;
  const eligible: Array<{
    entry: QuizVocabularyEntry;
    direction: Exclude<MixedCapacityDirection, "none">;
  }> = [];
  for (const entry of availablePrimary) {
    const direction = classify(entry);
    if (direction !== "none") eligible.push({ entry, direction });
  }
  const suffixCounts = Array.from(
    { length: eligible.length + 1 },
    () => ({ both: 0, english: 0, korean: 0 }),
  );
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const current = { ...suffixCounts[index + 1]! };
    current[eligible[index]!.direction] += 1;
    suffixCounts[index] = current;
  }

  const selected: QuizVocabularyEntry[] = [];
  let selectedEnglishOnly = 0;
  let selectedKoreanOnly = 0;
  for (const [index, candidate] of eligible.entries()) {
    if (selected.length === generalQuestionCount) break;
    const nextEnglishOnly =
      selectedEnglishOnly + (candidate.direction === "english" ? 1 : 0);
    const nextKoreanOnly =
      selectedKoreanOnly + (candidate.direction === "korean" ? 1 : 0);
    if (
      nextEnglishOnly > maximumGeneralEnglishOnly ||
      nextKoreanOnly > maximumGeneralKoreanOnly
    ) {
      continue;
    }
    const remainingSlots = generalQuestionCount - selected.length - 1;
    const suffix = suffixCounts[index + 1]!;
    const maximumSuffixSelection =
      suffix.both +
      Math.min(
        suffix.english,
        maximumGeneralEnglishOnly - nextEnglishOnly,
      ) +
      Math.min(
        suffix.korean,
        maximumGeneralKoreanOnly - nextKoreanOnly,
      );
    if (maximumSuffixSelection < remainingSlots) continue;
    selected.push(candidate.entry);
    selectedEnglishOnly = nextEnglishOnly;
    selectedKoreanOnly = nextKoreanOnly;
  }

  if (selected.length !== generalQuestionCount) {
    throw new Error("범위 앞쪽 단어의 출제 순서를 확정하지 못했습니다.");
  }
  return [...selected, ...required];
}

export function createMixedQuizQuestions(
  requiredTargets: readonly QuizVocabularyEntry[],
  primaryCandidates: readonly QuizVocabularyEntry[],
  allCandidates: readonly QuizVocabularyEntry[],
  totalQuestionCount: number,
  englishToKoreanRatio: 0 | 50 | 100,
  random: RandomSource = secureRandom,
): QuizQuestionDraft[] {
  if (
    !Number.isInteger(totalQuestionCount) ||
    totalQuestionCount < 4 ||
    totalQuestionCount > 500
  ) {
    throw new Error("혼합 시험 문항 수는 4~500개여야 합니다.");
  }
  if (requiredTargets.length > totalQuestionCount) {
    throw new Error(
      "혼합 시험의 오답 수가 총 문항 수보다 많습니다.",
    );
  }
  if (![0, 50, 100].includes(englishToKoreanRatio)) {
    throw new Error(
      "혼합 시험 문항 방향 비율은 0, 50, 100 중 하나여야 합니다.",
    );
  }

  const candidateById = new Map<number, QuizVocabularyEntry>();
  for (const candidate of allCandidates) {
    if (candidateById.has(candidate.id)) {
      throw new Error("전체 보기 후보 단어 ID가 중복되었습니다.");
    }
    candidateById.set(candidate.id, candidate);
  }

  const trustTargets = (
    targets: readonly QuizVocabularyEntry[],
    missingMessage: string,
  ) =>
    targets.map((target) => {
      const candidate = candidateById.get(target.id);
      if (!candidate) {
        throw new Error(missingMessage);
      }
      return candidate;
    });

  if (
    new Set(requiredTargets.map((entry) => entry.id)).size !==
    requiredTargets.length
  ) {
    throw new Error("혼합 시험 오답 대상 ID가 중복되었습니다.");
  }
  const trustedRequired = trustTargets(
    requiredTargets,
    "혼합 시험 오답 대상이 전체 보기 후보에 없습니다.",
  );
  const requiredIds = new Set(
    trustedRequired.map((entry) => entry.id),
  );
  const requiredIdentities = new Set(
    trustedRequired.map(quizVocabularyIdentity),
  );
  if (requiredIdentities.size !== trustedRequired.length) {
    throw new Error("혼합 시험 오답 대상 표제어가 중복되었습니다.");
  }

  if (
    new Set(primaryCandidates.map((entry) => entry.id)).size !==
    primaryCandidates.length
  ) {
    throw new Error("선택한 DAY의 후보 단어 ID가 중복되었습니다.");
  }
  const trustedPrimary = trustTargets(
    primaryCandidates,
    "선택한 DAY의 단어가 전체 보기 후보에 없습니다.",
  );
  const availablePrimary = trustedPrimary.filter(
    (entry) =>
      !requiredIds.has(entry.id) &&
      !requiredIdentities.has(quizVocabularyIdentity(entry)),
  );

  const targetScope = [...trustedRequired, ...availablePrimary];
  const {
    englishCandidateIds,
    koreanCandidateIds,
    promptSafeCandidateIds,
  } = buildDirectionalQuestionSets(targetScope, allCandidates);
  const classify = (entry: QuizVocabularyEntry) => {
    const english = englishCandidateIds.has(entry.id);
    const korean = koreanCandidateIds.has(entry.id);
    if (english && korean) return "both" as const;
    if (english) return "english" as const;
    if (korean) return "korean" as const;
    return "none" as const;
  };

  const requiredClasses = trustedRequired.map(classify);
  if (requiredClasses.includes("none")) {
    if (
      trustedRequired.some(
        (entry) =>
          promptSafeCandidateIds.has(entry.id) &&
          classify(entry) === "none",
      )
    ) {
      throw new Error(
        "서로 다른 4지선다 보기를 만들 어휘가 부족합니다.",
      );
    }
    throw new Error(
      "혼합 시험 오답 대상에 출제 가능한 방향이 없는 단어가 있습니다.",
    );
  }

  type PrimaryCanonicalGroup = {
    both?: QuizVocabularyEntry;
    english?: QuizVocabularyEntry;
    korean?: QuizVocabularyEntry;
  };
  const primaryGroups = new Map<string, PrimaryCanonicalGroup>();
  for (const entry of shuffle(availablePrimary, random)) {
    const identity = `entry:${entry.id}`;
    const directionClass = classify(entry);
    if (directionClass === "none") continue;

    const group = primaryGroups.get(identity) ?? {};
    if (directionClass === "both" && !group.both) {
      group.both = entry;
    } else if (
      directionClass === "english" &&
      !group.english
    ) {
      group.english = entry;
    } else if (
      directionClass === "korean" &&
      !group.korean
    ) {
      group.korean = entry;
    }
    primaryGroups.set(identity, group);
  }

  const bothGroups = shuffle(
    [...primaryGroups.values()].filter((group) => group.both),
    random,
  );
  const flexibleGroups = shuffle(
    [...primaryGroups.values()].filter(
      (group) =>
        !group.both && group.english && group.korean,
    ),
    random,
  );
  const englishOnlyGroups = shuffle(
    [...primaryGroups.values()].filter(
      (group) =>
        !group.both && group.english && !group.korean,
    ),
    random,
  );
  const koreanOnlyGroups = shuffle(
    [...primaryGroups.values()].filter(
      (group) =>
        !group.both && !group.english && group.korean,
    ),
    random,
  );
  const generalQuestionCount =
    totalQuestionCount - trustedRequired.length;
  const expectedEnglishCount = Math.round(
    totalQuestionCount * (englishToKoreanRatio / 100),
  );
  const expectedKoreanCount =
    totalQuestionCount - expectedEnglishCount;
  const requiredEnglishOnlyCount = requiredClasses.filter(
    (direction) => direction === "english",
  ).length;
  const requiredKoreanOnlyCount = requiredClasses.filter(
    (direction) => direction === "korean",
  ).length;
  const availableGeneralEnglish =
    expectedEnglishCount - requiredEnglishOnlyCount;
  const availableGeneralKorean =
    expectedKoreanCount - requiredKoreanOnlyCount;

  if (
    availableGeneralEnglish < 0 ||
    availableGeneralKorean < 0
  ) {
    throw new Error(
      "혼합 대상의 검증된 출제 방향으로 요청 비율을 만들 수 없습니다.",
    );
  }

  const selectedBothCount = Math.min(
    bothGroups.length,
    generalQuestionCount,
  );
  const selectedFlexibleCount = Math.min(
    flexibleGroups.length,
    generalQuestionCount - selectedBothCount,
  );
  const fixedQuestionCount =
    generalQuestionCount -
    selectedBothCount -
    selectedFlexibleCount;
  let selectedEnglishOnlyCount: number | null = null;
  let selectedKoreanOnlyCount = 0;
  let flexibleEnglishCount = 0;
  const maximumEnglishOnly = Math.min(
    englishOnlyGroups.length,
    fixedQuestionCount,
  );

  for (
    let englishOnlyCount = maximumEnglishOnly;
    englishOnlyCount >= 0;
    englishOnlyCount -= 1
  ) {
    const koreanOnlyCount =
      fixedQuestionCount - englishOnlyCount;
    if (koreanOnlyCount > koreanOnlyGroups.length) continue;

    const minimumFlexibleEnglish = Math.max(
      0,
      selectedFlexibleCount -
        (availableGeneralKorean - koreanOnlyCount),
    );
    const maximumFlexibleEnglish = Math.min(
      selectedFlexibleCount,
      availableGeneralEnglish - englishOnlyCount,
    );
    if (
      minimumFlexibleEnglish > maximumFlexibleEnglish ||
      maximumFlexibleEnglish < 0
    ) {
      continue;
    }

    selectedEnglishOnlyCount = englishOnlyCount;
    selectedKoreanOnlyCount = koreanOnlyCount;
    flexibleEnglishCount = maximumFlexibleEnglish;
    break;
  }

  if (selectedEnglishOnlyCount === null) {
    throw new Error(
      "선택한 DAY에서 오답과 함께 출제할 검증 단어가 부족합니다.",
    );
  }

  const selectedGeneral = shuffle(
    [
      ...bothGroups
        .slice(0, selectedBothCount)
        .map((group) => group.both!),
      ...flexibleGroups
        .slice(0, selectedFlexibleCount)
        .map((group, index) =>
          index < flexibleEnglishCount
            ? group.english!
            : group.korean!,
        ),
      ...englishOnlyGroups
        .slice(0, selectedEnglishOnlyCount)
        .map((group) => group.english!),
      ...koreanOnlyGroups
        .slice(0, selectedKoreanOnlyCount)
        .map((group) => group.korean!),
    ],
    random,
  );
  const questions = createTargetedQuizQuestions(
    [...selectedGeneral, ...trustedRequired],
    allCandidates,
    englishToKoreanRatio,
    random,
    { allowRepeatedVocabularyIdentity: true },
  );

  if (
    questions.length !== totalQuestionCount ||
    (trustedRequired.length > 0 &&
      questions
        .slice(-trustedRequired.length)
        .some(
          (question, index) =>
            question.vocabEntryId !== trustedRequired[index]?.id,
        ))
  ) {
    throw new Error("혼합 시험 문제 순서 검증에 실패했습니다.");
  }

  return questions;
}

