export type QuizVocabularyEntry = {
  id: number;
  headword: string;
  primaryMeaning: string;
};

export type QuizQuestionDraft = {
  vocabEntryId: number;
  direction: "english_to_korean" | "korean_to_english";
  prompt: string;
  choices: string[];
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
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function uniqueValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = normalizeChoice(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function createChoices(
  correct: string,
  candidates: readonly string[],
  random: RandomSource,
): { choices: string[]; correctChoiceIndex: number } {
  const correctKey = normalizeChoice(correct);
  const distractors = shuffle(
    uniqueValues(candidates).filter(
      (candidate) => normalizeChoice(candidate) !== correctKey,
    ),
    random,
  ).slice(0, 3);

  if (distractors.length !== 3) {
    throw new Error("서로 다른 4지선다 보기를 만들 어휘가 부족합니다.");
  }

  const choices = shuffle([correct, ...distractors], random);
  return {
    choices,
    correctChoiceIndex: choices.findIndex(
      (choice) => normalizeChoice(choice) === correctKey,
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
  const meaningCounts = new Map<string, number>();
  for (const entry of entries) {
    const meaningKey = normalizeChoice(entry.primaryMeaning);
    meaningCounts.set(
      meaningKey,
      (meaningCounts.get(meaningKey) ?? 0) + 1,
    );
  }
  const koreanEligible = entries.filter(
    (entry) =>
      meaningCounts.get(normalizeChoice(entry.primaryMeaning)) === 1,
  );
  if (koreanEligible.length < koreanCount) {
    throw new Error(
      "한글 뜻이 여러 영어 단어와 겹쳐 한→영 문항을 만들 수 없습니다.",
    );
  }

  const selectedKorean = shuffle(koreanEligible, random).slice(
    0,
    koreanCount,
  );
  const koreanIds = new Set(selectedKorean.map((entry) => entry.id));
  const selectedEnglish = shuffle(
    entries.filter((entry) => !koreanIds.has(entry.id)),
    random,
  ).slice(0, englishCount);
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
    const correct =
      direction === "english_to_korean"
        ? entry.primaryMeaning
        : entry.headword;
    const candidates = entries.map((candidate) =>
      direction === "english_to_korean"
        ? candidate.primaryMeaning
        : candidate.headword,
    );
    const { choices, correctChoiceIndex } = createChoices(
      correct,
      candidates,
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
