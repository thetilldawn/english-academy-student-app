import { describe, expect, it } from "vitest";

import {
  deriveAttemptQuestionMetrics,
  getResultQuestionPresentation,
} from "@/lib/quiz/result-presentation";

describe("getResultQuestionPresentation", () => {
  it("한글→영어 결과에서 문제는 한글, 정답은 영어로 분리한다", () => {
    expect(
      getResultQuestionPresentation({
        prompt: "현재의",
        correctAnswer: "current",
      }),
    ).toEqual({
      prompt: "현재의",
      correctAnswer: "current",
    });
  });
});

describe("deriveAttemptQuestionMetrics", () => {
  it("첫 시험 검토 단계의 정답·재시험 대상 수를 계산한다", () => {
    expect(
      deriveAttemptQuestionMetrics([
        { initialIsCorrect: true, retryIsCorrect: null },
        { initialIsCorrect: false, retryIsCorrect: null },
        { initialIsCorrect: false, retryIsCorrect: null },
        { initialIsCorrect: true, retryIsCorrect: null },
      ]),
    ).toEqual({
      questionCount: 4,
      initialCorrectCount: 2,
      retryCorrectCount: 0,
      unresolvedWrongCount: 2,
      initialScore: 50,
    });
  });

  it("재시험에서 맞힌 단어와 남은 단어를 분리한다", () => {
    expect(
      deriveAttemptQuestionMetrics([
        { initialIsCorrect: false, retryIsCorrect: true },
        { initialIsCorrect: false, retryIsCorrect: false },
        { initialIsCorrect: true, retryIsCorrect: null },
      ]),
    ).toMatchObject({
      initialCorrectCount: 1,
      retryCorrectCount: 1,
      unresolvedWrongCount: 1,
    });
  });
});
