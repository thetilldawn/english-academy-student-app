import { describe, expect, it } from "vitest";

import {
  deriveAttemptQuestionMetrics,
  getResultQuestionPresentation,
} from "@/lib/quiz/result-presentation";

describe("getResultQuestionPresentation", () => {
  it("한글→영어 결과에서 문제는 한글, 정답은 영어로 분리한다", () => {
    expect(
      getResultQuestionPresentation({
        direction: "korean_to_english",
        prompt: "current",
        correctAnswer: "current",
        headword: "current",
        primaryMeaning: "현재의",
        provenanceStatus: "verified_v2",
      }),
    ).toEqual({
      prompt: "현재의",
      correctAnswer: "current",
    });
  });

  it("영어→한글 결과는 단어와 뜻을 올바른 방향으로 표시한다", () => {
    expect(
      getResultQuestionPresentation({
        direction: "english_to_korean",
        prompt: "현재의",
        correctAnswer: "현재의",
        headword: "current",
        primaryMeaning: "현재의",
        provenanceStatus: "verified_v2",
      }),
    ).toEqual({
      prompt: "current",
      correctAnswer: "현재의",
    });
  });

  it("레거시는 현재 단어행과 달라도 당시 문제 표시를 유지한다", () => {
    expect(
      getResultQuestionPresentation({
        direction: "korean_to_english",
        prompt: "당시 뜻",
        correctAnswer: "old-headword",
        headword: "current",
        primaryMeaning: "현재 뜻",
        provenanceStatus: "legacy_backfill",
      }),
    ).toEqual({
      prompt: "당시 뜻",
      correctAnswer: "old-headword",
    });
  });

  it("Preview 검토본은 배정 당시 문맥 뜻을 양방향에 사용한다", () => {
    expect(
      getResultQuestionPresentation({
        direction: "korean_to_english",
        prompt: "현재 prompt",
        correctAnswer: "현재 정답",
        headword: "observe",
        primaryMeaning: "준수하다",
        provenanceStatus: "reviewed_for_preview_v1",
      }),
    ).toEqual({ prompt: "준수하다", correctAnswer: "observe" });
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
