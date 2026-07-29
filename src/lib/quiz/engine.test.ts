import { describe, expect, it } from "vitest";

import {
  calculateQuizScore,
  createQuizQuestions,
  createTargetedQuizQuestions,
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

describe("createTargetedQuizQuestions", () => {
  it.each([1, 2, 3])(
    "복습 대상 %i개를 빠짐없이 출제하고 각 문항은 4지선다로 만든다",
    (targetCount) => {
      const targets = entries.slice(0, targetCount);
      const questions = createTargetedQuizQuestions(
        targets,
        entries,
        50,
        seededRandom(targetCount),
      );

      expect(questions).toHaveLength(targetCount);
      expect(
        new Set(questions.map((question) => question.vocabEntryId)),
      ).toEqual(new Set(targets.map((entry) => entry.id)));
      expect(
        questions.filter(
          (question) =>
            question.direction === "english_to_korean",
        ),
      ).toHaveLength(Math.round(targetCount * 0.5));

      for (const question of questions) {
        expect(question.choices).toHaveLength(4);
        expect(new Set(question.choices)).toHaveLength(4);
        expect(question.choiceVocabEntryIds).toHaveLength(4);
        expect(new Set(question.choiceVocabEntryIds)).toHaveLength(4);
        expect(
          question.choiceVocabEntryIds[
            question.correctChoiceIndex
          ],
        ).toBe(question.vocabEntryId);
      }
    },
  );

  it("대상 단어의 검증 방향을 지키면서 요청 비율을 맞춘다", () => {
    const candidates = entries.map((entry, index) => ({
      ...entry,
      eligibleDirections:
        index === 0
          ? (["english_to_korean"] as const)
          : index === 1
            ? (["korean_to_english"] as const)
            : ([
                "english_to_korean",
                "korean_to_english",
              ] as const),
    }));
    const questions = createTargetedQuizQuestions(
      candidates.slice(0, 4),
      candidates,
      50,
      seededRandom(31),
    );
    const directionById = new Map(
      questions.map((question) => [
        question.vocabEntryId,
        question.direction,
      ]),
    );

    expect(directionById.get(1)).toBe("english_to_korean");
    expect(directionById.get(2)).toBe("korean_to_english");
    expect(
      questions.filter(
        (question) =>
          question.direction === "english_to_korean",
      ),
    ).toHaveLength(2);
  });

  it("검증 방향으로 요청 비율을 만들 수 없으면 중단한다", () => {
    const englishOnly = entries.map((entry) => ({
      ...entry,
      eligibleDirections: ["english_to_korean"] as const,
    }));

    expect(() =>
      createTargetedQuizQuestions(
        englishOnly.slice(0, 2),
        englishOnly,
        0,
        seededRandom(37),
      ),
    ).toThrow("요청 비율을 만들 수 없습니다.");
  });

  it("중복 대상과 후보 범위 밖 대상을 거부한다", () => {
    expect(() =>
      createTargetedQuizQuestions(
        [entries[0], entries[0]],
        entries,
        100,
        seededRandom(41),
      ),
    ).toThrow("같은 표제어를 겹치지 않고 1~500개");

    expect(() =>
      createTargetedQuizQuestions(
        [
          {
            id: 999,
            headword: "outside",
            primaryMeaning: "범위 밖",
          },
        ],
        entries,
        100,
        seededRandom(43),
      ),
    ).toThrow("보기 후보 범위에 없습니다.");
  });

  it("보기 후보가 부족하면 대상이 한 개여도 시험을 만들지 않는다", () => {
    expect(() =>
      createTargetedQuizQuestions(
        [entries[0]],
        entries.slice(0, 3),
        100,
        seededRandom(47),
      ),
    ).toThrow("서로 다른 4지선다 보기를 만들 어휘가 부족합니다.");
  });

  it("입력한 대상 순서를 보존해 고정 순서 문제은행을 만들 수 있다", () => {
    const targets = [entries[2], entries[0], entries[1]];
    const questions = createTargetedQuizQuestions(
      targets,
      entries,
      50,
      seededRandom(53),
    );

    expect(questions.map((question) => question.vocabEntryId)).toEqual(
      targets.map((entry) => entry.id),
    );
  });

  it("같은 canonical 단어를 대상이나 오답 보기에 중복 사용하지 않는다", () => {
    const candidates: QuizVocabularyEntry[] = [
      { ...entries[0], canonicalKey: "same-word" },
      {
        ...entries[1],
        headword: "alternate spelling",
        primaryMeaning: "다른 표기",
        canonicalKey: "same-word",
      },
      ...entries.slice(2).map((entry) => ({
        ...entry,
        canonicalKey: `word-${entry.id}`,
      })),
    ];

    expect(() =>
      createTargetedQuizQuestions(
        candidates.slice(0, 2).map((entry, index) => ({
          ...entry,
          canonicalKey: `untrusted-${index}`,
        })),
        candidates,
        50,
        seededRandom(59),
      ),
    ).toThrow("같은 표제어를 겹치지 않고 1~500개");

    const [question] = createTargetedQuizQuestions(
      [candidates[0]],
      candidates,
      100,
      seededRandom(61),
    );
    expect(question.choiceVocabEntryIds).not.toContain(candidates[1].id);
  });

  it("복습 시험 방향 비율은 화면 계약인 0, 50, 100만 허용한다", () => {
    expect(() =>
      createTargetedQuizQuestions(
        entries.slice(0, 4),
        entries,
        25,
        seededRandom(67),
      ),
    ).toThrow("0, 50, 100");
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
