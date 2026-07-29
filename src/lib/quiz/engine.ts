export type QuizDirection =
  | "english_to_korean"
  | "korean_to_english";

export type QuizVocabularyEntry = {
  id: number;
  headword: string;
  primaryMeaning: string;
  canonicalKey?: string | null;
  eligibleDirections?: readonly QuizDirection[];
};

export type QuizQuestionDraft = {
  vocabEntryId: number;
  direction: QuizDirection;
  prompt: string;
  choices: string[];
  choiceVocabEntryIds: number[];
  correctChoiceIndex: number;
};

export type QuizScoreInput = {
  initialIsCorrect: boolean;
  retryIsCorrect: boolean | null;
};

export type QuizScore = {
  initialCorrectCount: number;
  retryCorrectCount: number;
  unresolvedWrongCount: number;
  initialScore: number;
  finalScore: number;
};

export type RandomSource = () => number;

function normalizeChoice(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function canonicalIdentity(entry: QuizVocabularyEntry): string {
  const canonicalKey = entry.canonicalKey?.trim();

  return canonicalKey
    ? `canonical:${canonicalKey}`
    : `headword:${normalizeChoice(entry.headword).replaceAll("*", "")}`;
}

function canUseDirection(
  entry: QuizVocabularyEntry,
  direction: QuizDirection,
) {
  return (
    entry.eligibleDirections === undefined ||
    entry.eligibleDirections.includes(direction)
  );
}

function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function uniqueChoiceEntries(
  entries: readonly QuizVocabularyEntry[],
  display: (entry: QuizVocabularyEntry) => string,
): QuizVocabularyEntry[] {
  const seenDisplays = new Set<string>();
  const seenCanonicalIdentities = new Set<string>();
  const result: QuizVocabularyEntry[] = [];

  for (const entry of entries) {
    const displayKey = normalizeChoice(display(entry));
    const identity = canonicalIdentity(entry);
    if (
      seenDisplays.has(displayKey) ||
      seenCanonicalIdentities.has(identity)
    ) {
      continue;
    }
    seenDisplays.add(displayKey);
    seenCanonicalIdentities.add(identity);
    result.push(entry);
  }

  return result;
}

function createChoices(
  target: QuizVocabularyEntry,
  candidates: readonly QuizVocabularyEntry[],
  display: (entry: QuizVocabularyEntry) => string,
  random: RandomSource,
): {
  choices: string[];
  choiceVocabEntryIds: number[];
  correctChoiceIndex: number;
} {
  const correctKey = normalizeChoice(display(target));
  const correctIdentity = canonicalIdentity(target);
  const distractors = shuffle(
    uniqueChoiceEntries(candidates, display).filter(
      (candidate) =>
        candidate.id !== target.id &&
        canonicalIdentity(candidate) !== correctIdentity &&
        normalizeChoice(display(candidate)) !== correctKey,
    ),
    random,
  ).slice(0, 3);

  if (distractors.length !== 3) {
    throw new Error("서로 다른 4지선다 보기를 만들 어휘가 부족합니다.");
  }

  const choiceEntries = shuffle([target, ...distractors], random);
  return {
    choices: choiceEntries.map(display),
    choiceVocabEntryIds: choiceEntries.map((entry) => entry.id),
    correctChoiceIndex: choiceEntries.findIndex(
      (entry) => entry.id === target.id,
    ),
  };
}

function secureRandom(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

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
  const englishEligible = entries.filter((entry) =>
    canUseDirection(entry, "english_to_korean"),
  );
  const koreanDirectionEligible = entries.filter((entry) =>
    canUseDirection(entry, "korean_to_english"),
  );
  const meaningCounts = new Map<string, number>();
  for (const entry of koreanDirectionEligible) {
    const meaningKey = normalizeChoice(entry.primaryMeaning);
    meaningCounts.set(
      meaningKey,
      (meaningCounts.get(meaningKey) ?? 0) + 1,
    );
  }
  const koreanEligible = koreanDirectionEligible.filter(
    (entry) =>
      meaningCounts.get(normalizeChoice(entry.primaryMeaning)) === 1,
  );
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
    const candidates =
      direction === "english_to_korean"
        ? englishEligible
        : koreanEligible;
    const {
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    } = createChoices(
      entry,
      candidates,
      display,
      random,
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
    new Set(trustedTargets.map(canonicalIdentity)).size !==
    trustedTargets.length
  ) {
    throw new Error(
      "복습 대상 단어는 같은 표제어를 겹치지 않고 1~500개여야 합니다.",
    );
  }

  const englishCandidates = candidates.filter((entry) =>
    canUseDirection(entry, "english_to_korean"),
  );
  const koreanDirectionCandidates = candidates.filter((entry) =>
    canUseDirection(entry, "korean_to_english"),
  );
  const meaningCounts = new Map<string, number>();
  for (const entry of koreanDirectionCandidates) {
    const meaningKey = normalizeChoice(entry.primaryMeaning);
    meaningCounts.set(
      meaningKey,
      (meaningCounts.get(meaningKey) ?? 0) + 1,
    );
  }
  const koreanCandidates = koreanDirectionCandidates.filter(
    (entry) =>
      meaningCounts.get(normalizeChoice(entry.primaryMeaning)) === 1,
  );
  const englishCandidateIds = new Set(
    englishCandidates.map((entry) => entry.id),
  );
  const koreanCandidateIds = new Set(
    koreanCandidates.map((entry) => entry.id),
  );
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
    const choiceCandidates =
      direction === "english_to_korean"
        ? englishCandidates
        : koreanCandidates;
    const {
      choices,
      choiceVocabEntryIds,
      correctChoiceIndex,
    } = createChoices(
      entry,
      choiceCandidates,
      display,
      random,
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

export function calculateQuizScore(
  questions: readonly QuizScoreInput[],
): QuizScore {
  if (questions.length === 0) {
    throw new Error("채점할 문항이 없습니다.");
  }

  const initialCorrectCount = questions.filter(
    (question) => question.initialIsCorrect,
  ).length;
  const retryCorrectCount = questions.filter(
    (question) =>
      !question.initialIsCorrect && question.retryIsCorrect === true,
  ).length;
  const unresolvedWrongCount = questions.filter(
    (question) =>
      !question.initialIsCorrect && question.retryIsCorrect !== true,
  ).length;
  const initialScore = (initialCorrectCount / questions.length) * 100;
  const finalScore =
    ((initialCorrectCount + retryCorrectCount) / questions.length) * 100;

  return {
    initialCorrectCount,
    retryCorrectCount,
    unresolvedWrongCount,
    initialScore: Number(initialScore.toFixed(2)),
    finalScore: Number(finalScore.toFixed(2)),
  };
}
