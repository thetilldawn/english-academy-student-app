import { describe, expect, it } from "vitest";

import {
  calculateQuizScore,
  createQuizQuestions,
  type QuizVocabularyEntry,
} from "@/lib/quiz/engine";

const entries: QuizVocabularyEntry[] = Array.from(
  { length: 12 },
  (_, index) => ({
    id: index + 1,
    headword: `word-${index + 1}`,
    primaryMeaning: `뜻-${index + 1}`,
  }),
);

function seededRandom(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("createQuizQuestions", () => {
  it("두 방향을 50:50으로 만들고 모든 보기를 중복 없이 구성한다", () => {
    const questions = createQuizQuestions(
      entries,
      10,
      50,
      seededRandom(),
    );

    expect(
      questions.filter(
        (question) => question.direction === "english_to_korean",
      ),
    ).toHaveLength(5);
    expect(
      questions.filter(
        (question) => question.direction === "korean_to_english",
      ),
    ).toHaveLength(5);

    for (const question of questions) {
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices)).toHaveLength(4);
      expect(question.choiceVocabEntryIds).toHaveLength(4);
      expect(new Set(question.choiceVocabEntryIds)).toHaveLength(4);
      expect(
        question.choiceVocabEntryIds.filter(
          (entryId) => entryId === question.vocabEntryId,
        ),
      ).toHaveLength(1);
      expect(
        question.choiceVocabEntryIds[question.correctChoiceIndex],
      ).toBe(question.vocabEntryId);
      expect(question.correctChoiceIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctChoiceIndex).toBeLessThan(4);
    }
  });

  it("보기 문자열과 보기 단어 ID의 순서를 항상 맞춘다", () => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const questions = createQuizQuestions(
      entries,
      10,
      50,
      seededRandom(5),
    );

    for (const question of questions) {
      expect(
        question.choiceVocabEntryIds.map((entryId) => {
          const entry = byId.get(entryId);
          return question.direction === "english_to_korean"
            ? entry?.primaryMeaning
            : entry?.headword;
        }),
      ).toEqual(question.choices);
    }
  });

  it("홀수 문항도 두 방향 차이가 1을 넘지 않는다", () => {
    const questions = createQuizQuestions(
      entries,
      9,
      50,
      seededRandom(7),
    );
    const englishCount = questions.filter(
      (question) => question.direction === "english_to_korean",
    ).length;

    expect(Math.abs(englishCount - (questions.length - englishCount))).toBe(
      1,
    );
  });

  it("같은 한글 뜻이 여러 단어에 걸치면 한→영 문제에서 제외한다", () => {
    const ambiguousEntries = entries.map((entry, index) =>
      index < 2 ? { ...entry, primaryMeaning: "공통 뜻" } : entry,
    );
    const questions = createQuizQuestions(
      ambiguousEntries,
      8,
      50,
      seededRandom(11),
    );

    expect(
      questions.some(
        (question) =>
          question.direction === "korean_to_english" &&
          question.prompt === "공통 뜻",
      ),
    ).toBe(false);
  });

  it("DB가 허용한 방향으로만 각 단어를 출제한다", () => {
    const directionEntries = entries.map((entry, index) => ({
      ...entry,
      eligibleDirections:
        index < 6
          ? (["english_to_korean"] as const)
          : (["korean_to_english"] as const),
    }));
    const questions = createQuizQuestions(
      directionEntries,
      8,
      50,
      seededRandom(17),
    );
    const directionById = new Map(
      directionEntries.map((entry) => [
        entry.id,
        entry.eligibleDirections[0],
      ]),
    );

    for (const question of questions) {
      expect(directionById.get(question.vocabEntryId)).toBe(
        question.direction,
      );
    }
  });

  it("요청 방향의 검증된 단어가 부족하면 시험지를 만들지 않는다", () => {
    const englishOnly = entries.map((entry) => ({
      ...entry,
      eligibleDirections: ["english_to_korean"] as const,
    }));

    expect(() =>
      createQuizQuestions(
        englishOnly,
        8,
        50,
        seededRandom(19),
      ),
    ).toThrow("문제 방향별로 검증된 단어가 부족합니다.");
  });
});

describe("calculateQuizScore", () => {
  it("최초 점수와 재시도 해결·미해결을 분리한다", () => {
    expect(
      calculateQuizScore([
        { initialIsCorrect: true, retryIsCorrect: null },
        { initialIsCorrect: false, retryIsCorrect: true },
        { initialIsCorrect: false, retryIsCorrect: false },
        { initialIsCorrect: true, retryIsCorrect: null },
      ]),
    ).toEqual({
      initialCorrectCount: 2,
      retryCorrectCount: 1,
      unresolvedWrongCount: 1,
      initialScore: 50,
      finalScore: 75,
    });
  });
});
