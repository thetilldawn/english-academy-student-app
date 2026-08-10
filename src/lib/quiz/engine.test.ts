import { describe, expect, it } from "vitest";

import {
  calculateQuizScore,
  createMixedQuizQuestions,
  createQuizQuestions,
  createTargetedQuizQuestions,
  quizVocabularyIdentity,
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

  it("target eligibility does not shrink the distractor pool", () => {
    const targetEntries = Array.from({ length: 4 }, (_, index) => ({
      id: 5_000 + index,
      headword: `target-${index}`,
      primaryMeaning: "shared",
      canonicalKey: `target-${index}`,
    }));
    const distractorOnlyEntries = ["A", "B", "C"].map(
      (meaning, index) => ({
        id: 6_000 + index,
        headword: "ambiguous",
        primaryMeaning: meaning,
        canonicalKey: `distractor-${index}`,
      }),
    );

    const questions = createQuizQuestions(
      [...targetEntries, ...distractorOnlyEntries],
      4,
      100,
      seededRandom(17),
    );

    expect(questions).toHaveLength(4);
    expect(
      questions.every(
        (question) => new Set(question.choices).size === 4,
      ),
    ).toBe(true);
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
  it("품사·형태가 비슷한 후보를 쉬운 무관 후보보다 먼저 고른다", () => {
    const target: QuizVocabularyEntry = {
      id: 101,
      headword: "decide",
      primaryMeaning: "결정하다",
      recordType: "word",
    };
    const similar: QuizVocabularyEntry[] = [
      {
        id: 102,
        headword: "choose",
        primaryMeaning: "선택하다",
        recordType: "word",
      },
      {
        id: 103,
        headword: "solve",
        primaryMeaning: "해결하다",
        recordType: "word",
      },
      {
        id: 104,
        headword: "prefer",
        primaryMeaning: "선호하다",
        recordType: "word",
      },
    ];
    const unrelated: QuizVocabularyEntry = {
      id: 105,
      headword: "in spite of",
      primaryMeaning: "~에도 불구하고",
      recordType: "expression",
    };

    const [question] = createTargetedQuizQuestions(
      [target],
      [target, ...similar, unrelated],
      100,
      seededRandom(29),
    );

    expect(new Set(question.choiceVocabEntryIds)).toEqual(
      new Set([target.id, ...similar.map((entry) => entry.id)]),
    );
  });

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

  it("같은 문제 문구에 다른 답이 되는 후보는 보기에서 제외한다", () => {
    const englishCandidates: QuizVocabularyEntry[] = [
      {
        id: 101,
        headword: "observe",
        primaryMeaning: "관찰하다",
        canonicalKey: "word:observe-see",
      },
      {
        id: 102,
        headword: "observe",
        primaryMeaning: "준수하다",
        canonicalKey: "word:observe-follow",
      },
      ...entries.slice(2, 7).map((entry) => ({
        ...entry,
        id: entry.id + 100,
        canonicalKey: `word:choice-${entry.id}`,
      })),
    ];
    const [englishQuestion] = createTargetedQuizQuestions(
      [englishCandidates[0]],
      englishCandidates,
      100,
      seededRandom(63),
    );
    expect(englishQuestion.choiceVocabEntryIds).not.toContain(102);

    const koreanCandidates: QuizVocabularyEntry[] = [
      {
        id: 201,
        headword: "brief",
        primaryMeaning: "짧은",
        canonicalKey: "word:brief",
      },
      {
        id: 202,
        headword: "short",
        primaryMeaning: "짧은",
        canonicalKey: "word:short",
      },
      ...entries.slice(2, 7).map((entry) => ({
        ...entry,
        id: entry.id + 200,
        canonicalKey: `word:korean-choice-${entry.id}`,
      })),
    ];
    const [koreanQuestion] = createTargetedQuizQuestions(
      [koreanCandidates[0]],
      koreanCandidates,
      0,
      seededRandom(65),
    );
    expect(koreanQuestion.choiceVocabEntryIds).not.toContain(202);
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

describe("createMixedQuizQuestions", () => {
  it.each([0, 50, 100] as const)(
    "전체 문항의 영→한 비율을 %i%%로 정확히 맞추고 오답을 꼬리에 보존한다",
    (ratio) => {
      const required = entries.slice(0, 2);
      const primary = entries.slice(2, 10);
      const questions = createMixedQuizQuestions(
        required,
        primary,
        entries,
        6,
        ratio,
        seededRandom(ratio + 71),
      );

      expect(questions).toHaveLength(6);
      expect(
        questions
          .slice(-required.length)
          .map((question) => question.vocabEntryId),
      ).toEqual(required.map((entry) => entry.id));
      expect(
        questions
          .slice(0, -required.length)
          .every((question) =>
            primary.some(
              (entry) => entry.id === question.vocabEntryId,
            ),
          ),
      ).toBe(true);
      expect(
        questions.filter(
          (question) =>
            question.direction === "english_to_korean",
        ),
      ).toHaveLength(Math.round(questions.length * (ratio / 100)));
    },
  );

  it("오답의 강제 방향을 지키면서 전체 50:50을 만든다", () => {
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
    const questions = createMixedQuizQuestions(
      candidates.slice(0, 2),
      candidates.slice(2),
      candidates,
      6,
      50,
      seededRandom(79),
    );

    expect(questions.at(-2)?.direction).toBe(
      "english_to_korean",
    );
    expect(questions.at(-1)?.direction).toBe(
      "korean_to_english",
    );
    expect(
      questions.filter(
        (question) =>
          question.direction === "english_to_korean",
      ),
    ).toHaveLength(3);
  });

  it("같은 canonical의 방향별 occurrence 중 하나만 골라 가능한 비율을 만든다", () => {
    const candidates: QuizVocabularyEntry[] = [
      {
        ...entries[0],
        canonicalKey: "required",
      },
      {
        ...entries[1],
        canonicalKey: "flexible",
        eligibleDirections: ["english_to_korean"],
      },
      {
        ...entries[2],
        canonicalKey: "flexible",
        eligibleDirections: ["korean_to_english"],
      },
      {
        ...entries[3],
        canonicalKey: "english-only",
        eligibleDirections: ["english_to_korean"],
      },
      {
        ...entries[4],
        canonicalKey: "korean-only",
        eligibleDirections: ["korean_to_english"],
      },
      ...entries.slice(5).map((entry) => ({
        ...entry,
        canonicalKey: `candidate-${entry.id}`,
      })),
    ];
    const questions = createMixedQuizQuestions(
      [candidates[0]],
      candidates.slice(1, 5),
      candidates,
      4,
      50,
      seededRandom(83),
    );
    const targetIds = questions.map(
      (question) => question.vocabEntryId,
    );

    expect(
      targetIds.filter((id) => id === 2 || id === 3),
    ).toHaveLength(1);
    expect(
      questions.filter(
        (question) =>
          question.direction === "english_to_korean",
      ),
    ).toHaveLength(2);
  });

  it("보기는 주 DAY 밖의 전체 단어장 후보도 사용한다", () => {
    const candidates = entries.slice(0, 4);
    const required = [candidates[0]];
    const primary = candidates.slice(1);
    const questions = createMixedQuizQuestions(
      required,
      primary,
      candidates,
      4,
      100,
      seededRandom(89),
    );

    expect(
      questions
        .slice(0, 3)
        .every((question) =>
          question.choiceVocabEntryIds.includes(required[0].id),
        ),
    ).toBe(true);
  });

  it("선택한 출제 범위 밖의 같은 뜻은 한→영 대상을 막지 않는다", () => {
    const candidates = entries.map((entry) => ({ ...entry }));
    candidates[0].eligibleDirections = ["korean_to_english"];
    candidates[1].primaryMeaning = "중복 뜻";
    candidates[8].primaryMeaning = "중복 뜻";

    const questions = createMixedQuizQuestions(
      [candidates[0]],
      candidates.slice(1, 4),
      candidates,
      4,
      0,
      seededRandom(97),
    );

    expect(questions).toHaveLength(4);
    expect(
      questions.every(
        (question) => question.direction === "korean_to_english",
      ),
    ).toBe(true);
  });

  it("같은 표제어가 다른 DAY 행에 반복돼도 원본 175행을 모두 출제한다", () => {
    const sourceRows: QuizVocabularyEntry[] = Array.from(
      { length: 175 },
      (_, index) => ({
        id: index + 1,
        headword: `source-word-${index + 1}`,
        primaryMeaning: `원본 뜻-${index + 1}`,
        canonicalKey: `word:${index + 1}`,
      }),
    );
    sourceRows[80] = {
      ...sourceRows[80],
      headword: "economics",
      primaryMeaning: "경제학",
      canonicalKey: "word:economics",
    };
    sourceRows[81] = {
      ...sourceRows[81],
      headword: "economics",
      primaryMeaning: "경제학",
      canonicalKey: "word:economics",
    };
    sourceRows[172] = {
      ...sourceRows[172],
      headword: "realize",
      primaryMeaning: "깨닫다; 실현하다",
      canonicalKey: "word:realize",
    };
    sourceRows[173] = {
      ...sourceRows[173],
      headword: "realize",
      primaryMeaning: "깨닫다; 실현하다",
      canonicalKey: "word:realize",
    };

    const questions = createMixedQuizQuestions(
      [],
      sourceRows,
      sourceRows,
      175,
      50,
      seededRandom(99),
    );

    expect(questions).toHaveLength(175);
    expect(new Set(questions.map((question) => question.vocabEntryId))).toEqual(
      new Set(sourceRows.map((entry) => entry.id)),
    );
  });

  it("강제 방향으로 전체 비율을 만들 수 없으면 중단한다", () => {
    const candidates = entries.map((entry) => ({
      ...entry,
      eligibleDirections: ["english_to_korean"] as const,
    }));

    expect(() =>
      createMixedQuizQuestions(
        candidates.slice(0, 2),
        candidates.slice(2),
        candidates,
        4,
        0,
        seededRandom(101),
      ),
    ).toThrow("요청 비율을 만들 수 없습니다.");
  });

  it("오답과 겹치는 ID·canonical 후보는 주 DAY 일반 문항에서 제외한다", () => {
    const candidates = entries.map((entry) => ({
      ...entry,
      canonicalKey: `canonical-${entry.id}`,
    }));

    const idOverlap = createMixedQuizQuestions(
      [candidates[0]],
      [candidates[0], ...candidates.slice(2, 5)],
      candidates,
      4,
      100,
      seededRandom(103),
    );
    expect(
      idOverlap.filter(
        (question) => question.vocabEntryId === candidates[0].id,
      ),
    ).toHaveLength(1);
    expect(idOverlap.at(-1)?.vocabEntryId).toBe(candidates[0].id);

    const canonicalOverlapCandidates = [
      candidates[0],
      {
        ...candidates[1],
        canonicalKey: candidates[0].canonicalKey,
      },
      ...candidates.slice(2),
    ];
    const canonicalOverlap = createMixedQuizQuestions(
      [canonicalOverlapCandidates[0]],
      canonicalOverlapCandidates.slice(1, 5),
      canonicalOverlapCandidates,
      4,
      100,
      seededRandom(107),
    );
    expect(
      canonicalOverlap.some(
        (question) =>
          question.vocabEntryId ===
          canonicalOverlapCandidates[1].id,
      ),
    ).toBe(false);
    expect(canonicalOverlap.at(-1)?.vocabEntryId).toBe(
      canonicalOverlapCandidates[0].id,
    );
  });

  it("ID 중복·범위 밖 대상·canonical 중복 오답을 거절한다", () => {
    const canonicalCandidates = entries.map((entry) => ({
      ...entry,
      canonicalKey: `canonical-${entry.id}`,
    }));

    expect(() =>
      createMixedQuizQuestions(
        [canonicalCandidates[0], canonicalCandidates[0]],
        canonicalCandidates.slice(2),
        canonicalCandidates,
        4,
        100,
        seededRandom(109),
      ),
    ).toThrow("오답 대상 ID가 중복되었습니다.");

    const sameCanonicalRequired = [
      canonicalCandidates[0],
      {
        ...canonicalCandidates[1],
        canonicalKey: canonicalCandidates[0].canonicalKey,
      },
      ...canonicalCandidates.slice(2),
    ];
    expect(() =>
      createMixedQuizQuestions(
        [
          sameCanonicalRequired[0],
          sameCanonicalRequired[1],
        ],
        sameCanonicalRequired.slice(2),
        sameCanonicalRequired,
        4,
        100,
        seededRandom(113),
      ),
    ).toThrow("오답 대상 표제어가 중복되었습니다.");

    expect(() =>
      createMixedQuizQuestions(
        [
          {
            id: 999,
            headword: "outside",
            primaryMeaning: "범위 밖",
          },
        ],
        canonicalCandidates.slice(1, 5),
        canonicalCandidates,
        4,
        100,
        seededRandom(127),
      ),
    ).toThrow("전체 보기 후보에 없습니다.");

    expect(() =>
      createMixedQuizQuestions(
        [canonicalCandidates[0]],
        [
          canonicalCandidates[1],
          canonicalCandidates[1],
          ...canonicalCandidates.slice(2, 4),
        ],
        canonicalCandidates,
        4,
        100,
        seededRandom(131),
      ),
    ).toThrow("후보 단어 ID가 중복되었습니다.");

    expect(() =>
      createMixedQuizQuestions(
        [canonicalCandidates[0]],
        canonicalCandidates.slice(1, 5),
        [
          canonicalCandidates[0],
          canonicalCandidates[0],
          ...canonicalCandidates.slice(1),
        ],
        4,
        100,
        seededRandom(137),
      ),
    ).toThrow("전체 보기 후보 단어 ID가 중복되었습니다.");
  });

  it("오답만으로 합집합을 채우고 문항 수 경계와 unique canonical 부족을 거절한다", () => {
    const reviewOnly = createMixedQuizQuestions(
      entries.slice(0, 4),
      entries.slice(4),
      entries,
      4,
      50,
      seededRandom(139),
    );
    expect(reviewOnly).toHaveLength(4);
    expect(reviewOnly.map((question) => question.vocabEntryId)).toEqual(
      entries.slice(0, 4).map((entry) => entry.id),
    );
    expect(() =>
      createMixedQuizQuestions(
        [entries[0]],
        entries.slice(1),
        entries,
        3,
        50,
        seededRandom(149),
      ),
    ).toThrow("4~500");
    expect(() =>
      createMixedQuizQuestions(
        [entries[0]],
        entries.slice(1),
        entries,
        501,
        50,
        seededRandom(151),
      ),
    ).toThrow("4~500");

    const duplicateCanonical = entries.map((entry, index) => ({
      ...entry,
      canonicalKey:
        index === 0 ? "required" : "same-primary",
    }));
    expect(() =>
      createMixedQuizQuestions(
        [duplicateCanonical[0]],
        duplicateCanonical.slice(1),
        duplicateCanonical,
        4,
        50,
        seededRandom(157),
      ),
    ).toThrow("서로 다른 4지선다 보기를 만들 어휘가 부족합니다.");
  });

  it("작은 B/F/E/K 조합 전수에서 완전탐색 가능 여부와 일치한다", { timeout: 15_000 }, () => {
    type Capability = "B" | "F" | "E" | "K";
    const requiredVariants: Capability[][] = [
      ["E"],
      ["K"],
      ["B"],
      ["E", "K"],
      ["E", "B"],
      ["K", "B"],
      ["E", "E"],
      ["K", "K"],
      ["B", "B"],
      ["E", "K", "B"],
    ];
    const ratios = [0, 50, 100] as const;
    let scenario = 0;

    const isFeasible = (
      required: readonly Capability[],
      groups: readonly Capability[],
      generalCount: number,
      ratio: 0 | 50 | 100,
    ) => {
      const total = required.length + generalCount;
      const expectedEnglish = Math.round(total * (ratio / 100));
      const expectedKorean = total - expectedEnglish;
      const subsetCount = 2 ** groups.length;

      for (let mask = 0; mask < subsetCount; mask += 1) {
        const selected = groups.filter(
          (_, index) => (mask & (1 << index)) !== 0,
        );
        if (selected.length !== generalCount) continue;

        const combined = [...required, ...selected];
        const forcedEnglish = combined.filter(
          (capability) => capability === "E",
        ).length;
        const forcedKorean = combined.filter(
          (capability) => capability === "K",
        ).length;
        const flexible = combined.length - forcedEnglish - forcedKorean;
        if (
          forcedEnglish <= expectedEnglish &&
          forcedKorean <= expectedKorean &&
          expectedEnglish -
            forcedEnglish +
            (expectedKorean - forcedKorean) ===
            flexible
        ) {
          return true;
        }
      }
      return false;
    };

    for (let bothCount = 0; bothCount <= 2; bothCount += 1) {
      for (
        let flexibleCount = 0;
        flexibleCount <= 2;
        flexibleCount += 1
      ) {
        for (
          let englishCount = 0;
          englishCount <= 2;
          englishCount += 1
        ) {
          for (
            let koreanCount = 0;
            koreanCount <= 2;
            koreanCount += 1
          ) {
            const groupCapabilities: Capability[] = [
              ...Array<Capability>(bothCount).fill("B"),
              ...Array<Capability>(flexibleCount).fill("F"),
              ...Array<Capability>(englishCount).fill("E"),
              ...Array<Capability>(koreanCount).fill("K"),
            ];
            for (const requiredCapabilities of requiredVariants) {
              const minimumGeneral = Math.max(
                1,
                4 - requiredCapabilities.length,
              );
              const maximumGeneral = Math.min(
                3,
                groupCapabilities.length,
              );
              for (
                let generalCount = minimumGeneral;
                generalCount <= maximumGeneral;
                generalCount += 1
              ) {
                for (const ratio of ratios) {
                  scenario += 1;
                  let nextId = 1;
                  const makeEntry = (
                    capability: Exclude<Capability, "F">,
                    canonicalKey: string,
                  ): QuizVocabularyEntry => {
                    const id = nextId;
                    nextId += 1;
                    return {
                      id,
                      headword: `scenario-${scenario}-word-${id}`,
                      primaryMeaning: `scenario-${scenario}-뜻-${id}`,
                      canonicalKey,
                      eligibleDirections:
                        capability === "B"
                          ? [
                              "english_to_korean",
                              "korean_to_english",
                            ]
                          : capability === "E"
                            ? ["english_to_korean"]
                            : ["korean_to_english"],
                    };
                  };

                  const required = requiredCapabilities.map(
                    (capability, index) =>
                      makeEntry(
                        capability === "F" ? "B" : capability,
                        `required-${index}`,
                      ),
                  );
                  const primary: QuizVocabularyEntry[] = [];
                  groupCapabilities.forEach(
                    (capability, index) => {
                      const canonicalKey = `primary-${index}`;
                      if (capability === "F") {
                        primary.push(
                          makeEntry("E", canonicalKey),
                          makeEntry("K", canonicalKey),
                        );
                      } else {
                        primary.push(
                          makeEntry(capability, canonicalKey),
                        );
                      }
                    },
                  );
                  const distractors = Array.from(
                    { length: 4 },
                    (_, index) =>
                      makeEntry("B", `distractor-${index}`),
                  );
                  const allCandidates = [
                    ...required,
                    ...primary,
                    ...distractors,
                  ];

                  let succeeded = true;
                  try {
                    createMixedQuizQuestions(
                      required,
                      primary,
                      allCandidates,
                      required.length + generalCount,
                      ratio,
                      seededRandom(scenario),
                    );
                  } catch {
                    succeeded = false;
                  }

                  expect(
                    succeeded,
                    JSON.stringify({
                      requiredCapabilities,
                      groupCapabilities,
                      generalCount,
                      ratio,
                    }),
                  ).toBe(
                    isFeasible(
                      requiredCapabilities,
                      groupCapabilities,
                      generalCount,
                      ratio,
                    ),
                  );
                }
              }
            }
          }
        }
      }
    }
  });

  it("같은 seed와 입력이면 문제·순서·선지가 모두 같다", () => {
    const first = createMixedQuizQuestions(
      entries.slice(0, 2),
      entries.slice(2),
      entries,
      7,
      50,
      seededRandom(163),
    );
    const second = createMixedQuizQuestions(
      entries.slice(0, 2),
      entries.slice(2),
      entries,
      7,
      50,
      seededRandom(163),
    );

    expect(second).toEqual(first);
  });

  it("표제어와 표시값이 교차 중복돼도 가능한 3개 보기를 정확히 찾는다", () => {
    const target: QuizVocabularyEntry = {
      id: 1001,
      headword: "target",
      primaryMeaning: "W",
      canonicalKey: "T",
      eligibleDirections: ["english_to_korean"],
    };
    const candidates: QuizVocabularyEntry[] = [
      target,
      {
        id: 1002,
        headword: "a-x",
        primaryMeaning: "X",
        canonicalKey: "A",
      },
      {
        id: 1003,
        headword: "a-y",
        primaryMeaning: "Y",
        canonicalKey: "A",
      },
      {
        id: 1004,
        headword: "b-x",
        primaryMeaning: "X",
        canonicalKey: "B",
      },
      {
        id: 1005,
        headword: "b-z",
        primaryMeaning: "Z",
        canonicalKey: "B",
      },
      {
        id: 1006,
        headword: "c-z",
        primaryMeaning: "Z",
        canonicalKey: "C",
      },
    ];

    const [question] = createTargetedQuizQuestions(
      [target],
      candidates,
      100,
      seededRandom(181),
    );
    expect(question.choices).toHaveLength(4);
    expect(new Set(question.choices)).toHaveLength(4);
    expect(
      new Set(
        question.choiceVocabEntryIds.map((id) =>
          quizVocabularyIdentity(
            candidates.find((candidate) => candidate.id === id)!,
          ),
        ),
      ),
    ).toHaveLength(4);
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
