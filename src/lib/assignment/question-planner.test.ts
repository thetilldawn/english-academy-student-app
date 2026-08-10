import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_QUESTION_PLAN_VERSION,
  buildAssignmentQuestionPlan,
  calculateAssignmentQuestionCapacity,
  calculateAssignmentQuestionRange,
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
});
