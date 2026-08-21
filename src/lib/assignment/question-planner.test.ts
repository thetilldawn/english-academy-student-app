import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_QUESTION_PLAN_VERSION,
  buildAssignmentQuestionPlan,
  buildExactAssignmentQuestionPlan,
  calculateAssignmentQuestionCapacity,
  calculateAssignmentQuestionRange,
  calculateAssignmentSeriesQuestionCapacity,
} from "@/lib/assignment/question-planner";
import type { QuizVocabularyEntry } from "@/lib/quiz/engine";

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const fragileOccurrences: QuizVocabularyEntry[] = [
  { id: 1, headword: "u", primaryMeaning: "Y", canonicalKey: "A" },
  { id: 2, headword: "t", primaryMeaning: "X", canonicalKey: "A" },
  { id: 3, headword: "v", primaryMeaning: "X", canonicalKey: "B" },
  { id: 4, headword: "c", primaryMeaning: "Z", canonicalKey: "C" },
  { id: 5, headword: "d", primaryMeaning: "W", canonicalKey: "D" },
];

describe("assignment question planner", () => {
  it("source occurrence 계약 버전을 명시한다", () => {
    expect(ASSIGNMENT_QUESTION_PLAN_VERSION).toBe(
      "source-occurrence-v2-exact",
    );
  });

  it("같은 후보와 조건은 preview와 create에서 같은 계획을 만든다", () => {
    const input = {
      primaryCandidates: fragileOccurrences,
      allCandidates: fragileOccurrences,
      questionCount: 4,
      englishToKoreanRatio: 100 as const,
    };
    expect(buildAssignmentQuestionPlan(input)).toEqual(
      buildAssignmentQuestionPlan(input),
    );
  });

  it("같은 배정 seed는 같은 출제 대상을 만들고 새 배정 seed는 새 흐름을 만든다", () => {
    const candidates = Array.from({ length: 20 }, (_, index) => ({
      id: 50_000 + index,
      headword: `word-${index}`,
      primaryMeaning: `뜻-${index}`,
      canonicalKey: `word-${index}`,
    }));
    const plan = (randomSeed: string) => buildAssignmentQuestionPlan({
      primaryCandidates: candidates,
      allCandidates: candidates,
      questionCount: 8,
      englishToKoreanRatio: 50,
      targetSelectionMode: "random",
      randomSeed,
    }).map((question) => question.vocabEntryId);

    expect(plan("assignment-a:student-a:session-1")).toEqual(
      plan("assignment-a:student-a:session-1"),
    );
    expect(plan("assignment-b:student-a:session-1")).not.toEqual(
      plan("assignment-a:student-a:session-1"),
    );
    expect(plan("assignment-a:student-b:session-1")).not.toEqual(
      plan("assignment-a:student-a:session-1"),
    );
  });

  it("범위순 출제 대상은 후보의 원래 순서를 우선하고 문제 표시 순서와 분리된다", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      id: 60_000 + index,
      headword: `source-${index}`,
      primaryMeaning: `원뜻-${index}`,
      canonicalKey: `source-${index}`,
    }));
    const questions = buildAssignmentQuestionPlan({
      primaryCandidates: candidates,
      allCandidates: candidates,
      questionCount: 6,
      englishToKoreanRatio: 50,
      targetSelectionMode: "source_order",
      randomSeed: "assignment-a:student-a:session-1",
    });
    expect(new Set(questions.map((question) => question.vocabEntryId))).toEqual(
      new Set(candidates.slice(0, 6).map((candidate) => candidate.id)),
    );
  });

  it("범위순은 방향 자격이 섞여도 출제 가능한 앞 N개를 유지한다", () => {
    const directional = Array.from({ length: 12 }, (_, index) => ({
      id: 61_000 + index,
      headword: `directional-${index}`,
      primaryMeaning: `방향-${index}`,
      canonicalKey: `directional-${index}`,
      ...(index < 4
        ? {
            eligibleDirections: [
              index % 2 === 0
                ? "english_to_korean" as const
                : "korean_to_english" as const,
            ],
          }
        : {}),
    }));
    const questions = buildAssignmentQuestionPlan({
      primaryCandidates: directional,
      allCandidates: directional,
      questionCount: 4,
      englishToKoreanRatio: 50,
      targetSelectionMode: "source_order",
      randomSeed: "source-order-direction-mix",
    });

    expect(new Set(questions.map((question) => question.vocabEntryId))).toEqual(
      new Set(directional.slice(0, 4).map((candidate) => candidate.id)),
    );
  });

  it.each(["source_order", "random"] as const)(
    "%s는 같은 사전 단어의 서로 다른 출처 항목도 출제 대상으로 유지한다",
    (targetSelectionMode) => {
      const candidates = Array.from({ length: 8 }, (_, index) => ({
        id: 62_000 + index,
        headword: `occurrence-${index}`,
        primaryMeaning: `출처 뜻-${index}`,
        canonicalKey: index < 2 ? "same-lexeme" : `lexeme-${index}`,
      }));

      expect(calculateAssignmentQuestionCapacity({
        primaryCandidates: candidates,
        allCandidates: candidates,
        englishToKoreanRatio: 50,
      })).toBe(8);
      expect(() => buildAssignmentQuestionPlan({
        primaryCandidates: candidates,
        allCandidates: candidates,
        questionCount: 4,
        englishToKoreanRatio: 50,
        targetSelectionMode,
        randomSeed: "same-source-occurrence",
      })).not.toThrow();
    },
  );

  it("확정 대상은 같은 canonical의 서로 다른 출처 ID도 한 회차에 보존한다", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      id: 63_000 + index,
      headword: `exact-occurrence-${index}`,
      primaryMeaning: `확정 뜻-${index}`,
      canonicalKey: index < 2 ? "same-exact-lexeme" : `exact-${index}`,
    }));
    const questions = buildExactAssignmentQuestionPlan({
      targets: candidates.slice(0, 4),
      allCandidates: candidates,
      englishToKoreanRatio: 50,
      randomSeed: "exact-source-occurrences",
    });
    expect(new Set(questions.map((question) => question.vocabEntryId))).toEqual(
      new Set(candidates.slice(0, 4).map((candidate) => candidate.id)),
    );
  });

  it("요청 비율 때문에 실제로 가능한 최소 문항 수를 계산한다", () => {
    const englishOnly = Array.from({ length: 4 }, (_, index) => ({
      id: 2001 + index,
      headword: `english-${index}`,
      primaryMeaning: `영어뜻-${index}`,
      canonicalKey: `english-${index}`,
      eligibleDirections: ["english_to_korean" as const],
    }));
    const koreanOnly = Array.from({ length: 4 }, (_, index) => ({
      id: 3001 + index,
      headword: `korean-${index}`,
      primaryMeaning: `한국뜻-${index}`,
      canonicalKey: `korean-${index}`,
      eligibleDirections: ["korean_to_english" as const],
    }));

    expect(
      calculateAssignmentQuestionRange({
        requiredTargets: englishOnly,
        primaryCandidates: koreanOnly,
        allCandidates: [...englishOnly, ...koreanOnly],
        englishToKoreanRatio: 50,
      }),
    ).toEqual({
      minimumQuestionCount: 7,
      maximumQuestionCount: 8,
    });
  });

  it("capacity가 허용한 regular 문항 수는 어떤 생성 shuffle에서도 성공한다", () => {
    const maximum = calculateAssignmentQuestionCapacity({
      primaryCandidates: fragileOccurrences,
      allCandidates: fragileOccurrences,
      englishToKoreanRatio: 100,
    });
    expect(maximum).toBe(4);

    for (let seed = 1; seed <= 100; seed += 1) {
      expect(() =>
        buildAssignmentQuestionPlan(
          {
            primaryCandidates: fragileOccurrences,
            allCandidates: fragileOccurrences,
            questionCount: maximum,
            englishToKoreanRatio: 100,
          },
          seededRandom(seed),
        ),
      ).not.toThrow();
    }
  });

  it("앞 회차 정답은 다음 회차 대상에서 빼도 4지선다 보기 후보로 유지한다", () => {
    const candidates = ["A", "B", "C", "D", "A", "A", "A", "A"].map(
      (primaryMeaning, index) => ({
        id: 70_000 + index,
        headword: `choice-${index}`,
        primaryMeaning,
        canonicalKey: `choice-${index}`,
      }),
    );
    const nextSessionTargets = candidates.slice(4);

    expect(() => buildAssignmentQuestionPlan({
      primaryCandidates: nextSessionTargets,
      allCandidates: candidates,
      questionCount: 4,
      englishToKoreanRatio: 100,
      targetSelectionMode: "source_order",
      randomSeed: "next-session",
    })).not.toThrow();
    expect(calculateAssignmentQuestionCapacity({
      primaryCandidates: nextSessionTargets,
      allCandidates: candidates,
      englishToKoreanRatio: 100,
    })).toBe(4);
  });

  it("capacity가 허용한 mixed 문항 수는 필수 오답을 보존하며 항상 성공한다", () => {
    const requiredTargets = [fragileOccurrences[3]];
    const primaryCandidates = fragileOccurrences.filter(
      (entry) => entry.id !== requiredTargets[0].id,
    );
    const maximum = calculateAssignmentQuestionCapacity({
      requiredTargets,
      primaryCandidates,
      allCandidates: fragileOccurrences,
      englishToKoreanRatio: 100,
    });
    expect(maximum).toBe(4);

    for (let seed = 1; seed <= 100; seed += 1) {
      const questions = buildAssignmentQuestionPlan(
        {
          requiredTargets,
          primaryCandidates,
          allCandidates: fragileOccurrences,
          questionCount: maximum,
          englishToKoreanRatio: 100,
        },
        seededRandom(seed),
      );
      expect(questions).toHaveLength(4);
      expect(questions.at(-1)?.vocabEntryId).toBe(
        requiredTargets[0].id,
      );
    }
  });

  it("175 source occurrences calculate one exact contiguous range", () => {
    const occurrences = Array.from({ length: 175 }, (_, index) => ({
      id: 10_000 + index,
      headword: `occurrence-${index}`,
      primaryMeaning: `meaning-${index}`,
      canonicalKey: `occurrence-${index}`,
    }));

    expect(
      calculateAssignmentQuestionRange({
        primaryCandidates: occurrences,
        allCandidates: occurrences,
        englishToKoreanRatio: 50,
      }),
    ).toEqual({
      minimumQuestionCount: 4,
      maximumQuestionCount: 175,
    });
  });

  it("여러 회차 나누기 용량은 한 시험 500문항 상한과 별도로 계산한다", () => {
    const occurrences = Array.from({ length: 800 }, (_, index) => ({
      id: 80_000 + index,
      headword: `series-${index}`,
      primaryMeaning: `연속뜻-${index}`,
      canonicalKey: `series-${index}`,
    }));

    expect(calculateAssignmentQuestionCapacity({
      primaryCandidates: occurrences,
      allCandidates: occurrences,
      englishToKoreanRatio: 50,
    })).toBe(500);
    expect(calculateAssignmentSeriesQuestionCapacity({
      primaryCandidates: occurrences,
      allCandidates: occurrences,
      englishToKoreanRatio: 50,
    })).toBe(800);
  });

  it("여러 회차 용량은 같은 철자의 다른 sense를 회차 간 충돌로 잘못 빼지 않는다", () => {
    const candidates: QuizVocabularyEntry[] = [
      {
        id: 90_001,
        headword: "observe",
        primaryMeaning: "관찰하다",
        canonicalKey: "observe",
      },
      {
        id: 90_002,
        headword: "observe",
        primaryMeaning: "엄수하다",
        canonicalKey: "observe",
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: 90_003 + index,
        headword: `series-sense-${index}`,
        primaryMeaning: `회차 뜻-${index}`,
        canonicalKey: `series-sense-${index}`,
      })),
    ];
    expect(calculateAssignmentSeriesQuestionCapacity({
      primaryCandidates: candidates,
      allCandidates: candidates,
      englishToKoreanRatio: 100,
    })).toBe(8);
    expect(buildExactAssignmentQuestionPlan({
      targets: [candidates[0]!, ...candidates.slice(2, 5)],
      allCandidates: candidates,
      englishToKoreanRatio: 100,
      randomSeed: "sense-one",
      targetDirections: Array(4).fill("english_to_korean"),
    })).toHaveLength(4);
    expect(buildExactAssignmentQuestionPlan({
      targets: [candidates[1]!, ...candidates.slice(5, 8)],
      allCandidates: candidates,
      englishToKoreanRatio: 100,
      randomSeed: "sense-two",
      targetDirections: Array(4).fill("english_to_korean"),
    })).toHaveLength(4);
  });
});
